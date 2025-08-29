# PowerShell MCP Server Usage Guide

This guide demonstrates how to use the PowerShell MCP Server (`run-powershell` tool) safely with timeout protection and file logging for MCP Index Server operations.

## ✅ Key Benefits Over Regular Terminal

- **Automatic timeout handling** - No more hung processes
- **Process tree cleanup** - Prevents zombie processes  
- **Working directory context** - Commands run in correct location
- **Structured responses** - Execution metrics and detailed status
- **Security assessment** - Risk categorization for commands
- **File logging integration** - Works with MCP_LOG_FILE

## 🛡️ Essential Parameters

### Required for Safety

```yaml
aiAgentTimeoutSec: 15        # Timeout in seconds (prevents hangs)
confirmed: true              # Handle security prompts automatically
workingDirectory: "C:\path"  # Explicit working directory
```

### Environment Variables

```powershell
$env:MCP_LOG_FILE = "session.log"     # Enable file logging
$env:MCP_LOG_VERBOSE = "1"            # Verbose logging
```

## 📋 Usage Patterns

### 1. Simple Command Execution

```yaml
mcp_powershell-mc_run-powershell:
  aiAgentTimeoutSec: 10
  confirmed: true
  workingDirectory: "C:\github\jagilber\mcp-index-server"
  command: "Get-ChildItem *.json | Select-Object -First 5"
```

### 2. Multi-line Script

```yaml
mcp_powershell-mc_run-powershell:
  aiAgentTimeoutSec: 20
  confirmed: true
  workingDirectory: "C:\github\jagilber\mcp-index-server"
  script: |
    $env:MCP_LOG_FILE = "build-session.log"
    npm run build
    if ($LASTEXITCODE -eq 0) {
      Write-Output "✅ Build successful"
    } else {
      Write-Output "❌ Build failed"
    }
```

### 3. Using Template Script

```yaml
mcp_powershell-mc_run-powershell:
  aiAgentTimeoutSec: 15
  confirmed: true
  workingDirectory: "C:\github\jagilber\mcp-index-server"  
  script: ".\scripts\powershell-mcp-template.ps1 -Operation 'status' -LogFile 'status.log'"
```

## 🔧 Common Operations

### Project Status Check

```powershell
# Check build, package info, source files, logs
$buildReady = Test-Path "dist/server/index.js"
$pkg = Get-Content "package.json" | ConvertFrom-Json
$srcCount = (Get-ChildItem "src" -Filter "*.ts" -Recurse).Count
```

### Safe Process Management

```powershell
# Kill hung processes safely
Get-Process -Name "node" | Where-Object { 
  $_.Path -like "*mcp-index-server*" 
} | Stop-Process -Force -ErrorAction SilentlyContinue
```

### Environment Setup

```powershell
# Set up logging environment
$env:MCP_LOG_FILE = "production-$(Get-Date -Format 'yyyy-MM-dd-HHmm').log"
$env:MCP_LOG_VERBOSE = "1"
```

## ⚠️ Best Practices

1. **Always set timeouts** - Use `aiAgentTimeoutSec` (5-30 seconds typical)
2. **Specify working directory** - Avoid path confusion  
3. **Use confirmed=true** - Handle security prompts
4. **Clean up processes** - Use `Get-Process` and `Stop-Process`
5. **Structure responses** - PowerShell MCP provides execution metrics
6. **Environment scoping** - Set variables within script context

## 📊 Response Structure

The PowerShell MCP server returns detailed execution information:

- `success`: Boolean execution status
- `exitCode`: Process exit code  
- `duration_ms`: Execution time
- `timedOut`: Whether timeout occurred
- `terminationReason`: How process ended
- `securityAssessment`: Risk analysis
- `workingDirectory`: Confirmed execution context

## 🚀 File Logging Integration

The MCP Index Server file logging works seamlessly with PowerShell MCP:

1. Set `$env:MCP_LOG_FILE` in your script
2. MCP server logs to both stderr (VS Code) and file
3. Session headers and structured logs preserved
4. Automatic cleanup on process exit

## 📝 Template Usage

Use the provided template script for common operations:

```powershell
.\scripts\powershell-mcp-template.ps1 -Operation "status|build|test|deploy" -LogFile "session.log"
```

This provides a consistent, safe way to perform MCP Index Server operations with full logging and timeout protection.
