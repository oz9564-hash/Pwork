$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$hwp = $null
$currentStage = "SESSION_START"
$diagnostics = @{}

function Write-Trace([string]$Stage, $Details) {
  $trace = @{ stage = $Stage; details = $Details; timestamp = [DateTime]::UtcNow.ToString("o") } |
    ConvertTo-Json -Depth 6 -Compress
  [Console]::Error.WriteLine("HWP_TRACE $trace")
  [Console]::Error.Flush()
}

function Send-Response([string]$Id, [bool]$Ok, $Result, [string]$Message) {
  @{ id = $Id; ok = $Ok; result = $Result; message = $Message } |
    ConvertTo-Json -Depth 6 -Compress |
    ForEach-Object { [Console]::Out.WriteLine($_); [Console]::Out.Flush() }
}

try {
  while ($null -ne ($line = [Console]::In.ReadLine())) {
    if (-not $line.Trim()) { continue }
    $requestJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line.Trim()))
    $request = $requestJson | ConvertFrom-Json
    try {
      if ($request.action -eq "open") {
        $currentStage = "REQUEST_RECEIVED"
        $templatePath = [string]$request.templatePath
        $extension = [IO.Path]::GetExtension($templatePath).ToLowerInvariant()
        $exists = Test-Path -LiteralPath $templatePath -PathType Leaf
        $fileSize = if ($exists) { (Get-Item -LiteralPath $templatePath).Length } else { 0 }
        $format = if ($extension -eq ".hwpx") { "HWPX" } else { "HWP" }
        $diagnostics = @{
          path = $templatePath
          extension = $extension
          exists = $exists
          fileSize = $fileSize
          format = $format
        }
        Write-Trace $currentStage $diagnostics
        if (-not $exists) { throw "TEMPLATE_NOT_FOUND" }

        $currentStage = "PREVIOUS_SESSION_CLOSE"
        if ($null -ne $hwp) { try { $hwp.Quit() } catch {} }
        Write-Trace $currentStage @{ completed = $true }

        $currentStage = "COM_TYPE_LOOKUP"
        $hwpType = [Type]::GetTypeFromProgID("HWPFrame.HwpObject")
        if ($null -eq $hwpType) { throw "HWP_AUTOMATION_NOT_FOUND" }
        Write-Trace $currentStage @{ progId = "HWPFrame.HwpObject"; found = $true }

        $currentStage = "COM_INSTANCE_CREATE"
        $hwp = [Activator]::CreateInstance($hwpType)
        Write-Trace $currentStage @{ created = ($null -ne $hwp) }

        $currentStage = "SECURITY_MODULE_REGISTER"
        try {
          $registered = $hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModuleExample")
          Write-Trace $currentStage @{ registered = [bool]$registered }
        } catch {
          Write-Trace $currentStage @{ registered = $false; exception = $_.Exception.Message; hresult = $_.Exception.HResult }
        }

        $currentStage = "WINDOW_VISIBLE"
        $hwp.XHwpWindows.Item(0).Visible = $true
        Write-Trace $currentStage @{ visible = $true }

        $currentStage = "DOCUMENT_OPEN"
        Write-Trace $currentStage $diagnostics
        $opened = $hwp.Open($templatePath, $format, "")
        Write-Trace "DOCUMENT_OPEN_RESULT" @{ opened = [bool]$opened; format = $format; path = $templatePath }
        if (-not $opened) {
          throw "HWP_OPEN_FAILED"
        }
        Send-Response $request.id $true @{ opened = $true } ""
        continue
      }

      if ($null -eq $hwp) { throw "MAPPING_SESSION_NOT_STARTED" }

      if ($request.action -eq "assign") {
        $name = [string]$request.fieldName
        if (-not $name.Trim()) { throw "FIELD_NAME_EMPTY" }
        $assigned = $hwp.SetCurFieldName($name, 0, "", "")
        if (-not $assigned) { throw "FIELD_ASSIGN_FAILED" }
        Send-Response $request.id $true @{ fieldName = $name } ""
        continue
      }

      if ($request.action -eq "save") {
        if (-not $hwp.SaveAs([string]$request.outputPath, "HWP", "")) {
          throw "MAPPED_TEMPLATE_SAVE_FAILED"
        }
        Send-Response $request.id $true @{ outputPath = [string]$request.outputPath } ""
        continue
      }

      if ($request.action -eq "close") {
        try { $hwp.Quit() } catch {}
        $hwp = $null
        Send-Response $request.id $true @{ closed = $true } ""
        continue
      }

      throw "MAPPING_ACTION_UNSUPPORTED"
    } catch {
      $errorDetails = @{
        stage = $currentStage
        code = $_.Exception.Message
        exceptionType = $_.Exception.GetType().FullName
        hresult = $_.Exception.HResult
        diagnostics = $diagnostics
      }
      Write-Trace "ERROR" $errorDetails
      Send-Response $request.id $false $errorDetails $_.Exception.Message
    }
  }
} finally {
  if ($null -ne $hwp) {
    try { $hwp.Quit() } catch {}
    try { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($hwp) | Out-Null } catch {}
  }
}
