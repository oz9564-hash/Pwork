import { useCallback, useEffect, useState } from "react";

export type WorkspaceRoute =
  | { name: "poc" }
  | { name: "workspace-list" }
  | { name: "workspace"; workspaceId: string };

function readRoute(pathname = window.location.pathname): WorkspaceRoute {
  if (/^\/poc\/?$/.test(pathname)) return { name: "poc" };
  const match = pathname.match(/^\/workspaces\/([^/]+)\/?$/);
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
    window.history[replace ? "replaceState" : "pushState"]({}, "", "/workspaces");
    setRoute({ name: "workspace-list" });
  }, []);

  const navigateToWorkspace = useCallback((workspaceId: string, replace = false) => {
    const pathname = `/workspaces/${encodeURIComponent(workspaceId)}`;
    window.history[replace ? "replaceState" : "pushState"]({}, "", pathname);
    setRoute({ name: "workspace", workspaceId });
  }, []);

  return { route, navigateToWorkspaceList, navigateToWorkspace };
}
