param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadPath
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$payload = Get-Content -LiteralPath $PayloadPath -Raw -Encoding UTF8 | ConvertFrom-Json
$hwp = $null

function Write-Result($Value) {
  $Value | ConvertTo-Json -Depth 8 -Compress
}

function Replace-AllText($HwpObject, [string]$Source, [string]$Target) {
  if (-not $Source -or $Source -eq $Target) { return }
  $set = $HwpObject.HParameterSet.HFindReplace
  $HwpObject.HAction.GetDefault("AllReplace", $set.HSet)
  $set.FindString = $Source
  $set.ReplaceString = $Target
  $set.Direction = 0
  $set.IgnoreMessage = 1
  $set.ReplaceMode = 1
  $set.FindRegExp = 0
  $set.FindJaso = 0
  $null = $HwpObject.HAction.Execute("AllReplace", $set.HSet)
}

try {
  $hwpType = [Type]::GetTypeFromProgID("HWPFrame.HwpObject")
  if ($payload.action -eq "status") {
    Write-Result @{
      available = ($null -ne $hwpType)
      message = ""
    }
    exit 0
  }

  if ($null -eq $hwpType) {
    throw "HWP_AUTOMATION_NOT_FOUND"
  }
  if (-not (Test-Path -LiteralPath $payload.templatePath -PathType Leaf)) {
    throw "TEMPLATE_NOT_FOUND"
  }

  $hwp = [Activator]::CreateInstance($hwpType)
  try { $null = $hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModuleExample") } catch {}
  # POC 단계에서는 보안 승인·최초 실행 창을 사용자가 확인할 수 있도록 한글 창을 표시한다.
  $hwp.XHwpWindows.Item(0).Visible = $true
  $opened = $hwp.Open([string]$payload.templatePath, "HWP", "")
  if (-not $opened) { throw "HWP_OPEN_FAILED" }

  if ($payload.action -eq "inspect") {
    $fieldList = [string]$hwp.GetFieldList(0, 0)
    $fields = @()
    if ($fieldList) {
      $fields = @($fieldList -split [char]2 | Where-Object { $_ -and $_.Trim() })
    }
    Write-Result @{ fields = $fields }
    exit 0
  }

  if ($payload.action -eq "generate") {
    foreach ($replacement in @($payload.replacements)) {
      Replace-AllText $hwp ([string]$replacement.source) ([string]$replacement.target)
    }
    foreach ($property in $payload.values.PSObject.Properties) {
      $fieldName = [string]$property.Name
      $fieldValue = [string]$property.Value
      if ($hwp.FieldExist($fieldName)) {
        $hwp.PutFieldText($fieldName, $fieldValue)
      }
    }

    $saved = $hwp.SaveAs([string]$payload.outputPath, "HWP", "")
    if (-not $saved) { throw "HWP_SAVE_FAILED" }

    $previewSaved = $false
    try { $previewSaved = [bool]$hwp.SaveAs([string]$payload.previewPath, "PDF", "") } catch {}
    Write-Result @{
      outputPath = [string]$payload.outputPath
      previewPath = if ($previewSaved -and (Test-Path -LiteralPath $payload.previewPath)) { [string]$payload.previewPath } else { $null }
    }
    exit 0
  }

  throw "AUTOMATION_ACTION_UNSUPPORTED"
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
} finally {
  if ($null -ne $hwp) {
    try { $hwp.Quit() } catch {}
    try { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($hwp) | Out-Null } catch {}
  }
}
