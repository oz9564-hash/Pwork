import { useCallback, useEffect, useState } from "react";

export type WorkspaceRoute =
  | { name: "poc" }
  | { name: "workspace-list" }
  | { name: "workspace"; workspaceId: string };

function readRoute(pathname = window.location.pathname): WorkspaceRoute {
  const routePath = window.location.protocol === "file:" && window.location.hash.startsWith("#/")
    ? window.location.hash.slice(1)
    : pathname;
  if (/^\/poc\/?$/.test(routePath)) return { name: "poc" };
  const match = routePath.match(/^\/workspaces\/([^/]+)\/?$/);
  if (match) {
    return { name: "workspace", workspaceId: decodeURIComponent(match[1]) };
  }
  return { name: "workspace-list" };
}

export function useWorkspaceRouter() {
  const [route, setRoute] = useState<WorkspaceRoute>(() => readRoute());

  useEffect(() => {
    function handlePopState() {
      setRoute(readRoute());
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigateToWorkspaceList = useCallback((replace = false) => {
    if (window.location.protocol === "file:") {
      window.location.hash = "/workspaces";
      setRoute({ name: "workspace-list" });
      return;
    }
    window.history[replace ? "replaceState" : "pushState"]({}, "", "/workspaces");
    setRoute({ name: "workspace-list" });
  }, []);

  const navigateToWorkspace = useCallback((workspaceId: string, replace = false) => {
    const pathname = `/workspaces/${encodeURIComponent(workspaceId)}`;
    if (window.location.protocol === "file:") {
      window.location.hash = pathname;
      setRoute({ name: "workspace", workspaceId });
      return;
    }
    window.history[replace ? "replaceState" : "pushState"]({}, "", pathname);
    setRoute({ name: "workspace", workspaceId });
  }, []);

  return { route, navigateToWorkspaceList, navigateToWorkspace };
}
