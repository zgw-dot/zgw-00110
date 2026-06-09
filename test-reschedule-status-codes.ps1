$baseUrl = "http://localhost:3001/api"
$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  改期越权状态码回归测试" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ==================== 辅助函数 ====================
function Login($username, $password) {
    $body = @{ username = $username; password = $password } | ConvertTo-Json
    $resp = Invoke-RestMethod "$baseUrl/auth/login" -Method Post -Body $body -ContentType "application/json"
    return @{ "Authorization" = "Bearer $($resp.token)" }
}

function Test-Scenario($name, $expectedStatus, $scriptBlock) {
    Write-Host "场景: $name" -ForegroundColor Yellow
    Write-Host "  期望状态码: $expectedStatus" -ForegroundColor Gray
    try {
        & $scriptBlock
        Write-Host "  结果: 未抛出异常 (期望抛出)" -ForegroundColor Red
        return $false
    } catch {
        $actualStatus = $_.Exception.Response.StatusCode.value__
        $errorMsg = $_.ErrorDetails.Message
        Write-Host "  实际状态码: $actualStatus" -ForegroundColor Gray
        Write-Host "  错误信息: $($errorMsg.Substring(0, [Math]::Min(80, $errorMsg.Length)))" -ForegroundColor Gray

        if ($actualStatus -eq $expectedStatus) {
            Write-Host "  PASS ✓" -ForegroundColor Green
            return $true
        } else {
            Write-Host "  FAIL ✗ - 状态码不匹配" -ForegroundColor Red
            return $false
        }
    }
}

function Test-Success($name, $scriptBlock) {
    Write-Host "场景: $name" -ForegroundColor Yellow
    try {
        $result = & $scriptBlock
        Write-Host "  实际状态码: 200" -ForegroundColor Gray
        Write-Host "  PASS ✓" -ForegroundColor Green
        return @($true, $result)
    } catch {
        $actualStatus = $_.Exception.Response.StatusCode.value__
        $errorMsg = $_.ErrorDetails.Message
        Write-Host "  实际状态码: $actualStatus" -ForegroundColor Gray
        Write-Host "  错误信息: $errorMsg" -ForegroundColor Gray
        Write-Host "  FAIL ✗ - 期望成功但失败" -ForegroundColor Red
        return @($false, $null)
    }
}

# ==================== 初始化 ====================
Write-Host "--- 初始化测试数据 ---" -ForegroundColor Cyan

$zhangsanHeaders = Login "zhangsan" "user123"
$lisiHeaders = Login "lisi" "user123"
$adminHeaders = Login "admin" "admin123"
Write-Host "  登录成功" -ForegroundColor Gray

$venues = Invoke-RestMethod "$baseUrl/venues" -Headers $zhangsanHeaders
$venue = $venues | Where-Object { $_.deposit_amount -eq 0 } | Select-Object -First 1
Write-Host "  使用场地: $($venue.name) (押金: $($venue.deposit_amount))" -ForegroundColor Gray

$testDate1 = (Get-Date).AddDays(80).ToString("yyyy-MM-dd")
$testDate2 = (Get-Date).AddDays(81).ToString("yyyy-MM-dd")
$testDate3 = (Get-Date).AddDays(82).ToString("yyyy-MM-dd")
Write-Host "  测试日期1: $testDate1, 日期2: $testDate2, 日期3: $testDate3" -ForegroundColor Gray

# ==================== 场景1: 本人正常提交改期 (200) ====================
Write-Host ""
Write-Host "--- 测试场景 ---" -ForegroundColor Cyan

$createResult = Test-Success "创建预约 (zhangsan)" {
    $body = @{
        venueId = $venue.id
        date = $testDate1
        startTime = "09:00"
        endTime = "11:00"
        purpose = "回归测试-正常改期"
    } | ConvertTo-Json
    Invoke-RestMethod "$baseUrl/bookings" -Method Post -Body $body -Headers $zhangsanHeaders -ContentType "application/json"
}
$booking1 = $createResult[1]

$null = Test-Success "管理员审批预约" {
    Invoke-RestMethod "$baseUrl/bookings/$($booking1.id)/approve" -Method Post -Headers $adminHeaders -ContentType "application/json"
}

$scenario1 = Test-Success "1. 本人正常提交改期 (期望 200)" {
    $body = @{
        newDate = $testDate2
        newStartTime = "14:00"
        newEndTime = "16:00"
        reason = "正常改期原因"
    } | ConvertTo-Json
    Invoke-RestMethod "$baseUrl/bookings/$($booking1.id)/reschedule" -Method Post -Body $body -Headers $zhangsanHeaders -ContentType "application/json"
}

# ==================== 场景2: 越权改期 (403) ====================
$createResult2 = Test-Success "创建第二个预约 (zhangsan)" {
    $body = @{
        venueId = $venue.id
        date = $testDate3
        startTime = "09:00"
        endTime = "11:00"
        purpose = "回归测试-越权改期"
    } | ConvertTo-Json
    Invoke-RestMethod "$baseUrl/bookings" -Method Post -Body $body -Headers $zhangsanHeaders -ContentType "application/json"
}
$booking2 = $createResult2[1]

$null = Test-Success "管理员审批第二个预约" {
    Invoke-RestMethod "$baseUrl/bookings/$($booking2.id)/approve" -Method Post -Headers $adminHeaders -ContentType "application/json"
}

$scenario2 = Test-Scenario "2. 越权改期 (lisi 改 zhangsan 的预约) (期望 403)" 403 {
    $body = @{
        newDate = $testDate2
        newStartTime = "10:00"
        newEndTime = "12:00"
        reason = "越权改期"
    } | ConvertTo-Json
    Invoke-RestMethod "$baseUrl/bookings/$($booking2.id)/reschedule" -Method Post -Body $body -Headers $lisiHeaders -ContentType "application/json"
}

# ==================== 场景3: 非法时间 (400) ====================
$scenario3 = Test-Scenario "3. 非法时间范围 (结束早于开始) (期望 400)" 400 {
    $body = @{
        newDate = $testDate2
        newStartTime = "16:00"
        newEndTime = "14:00"
        reason = "非法时间"
    } | ConvertTo-Json
    Invoke-RestMethod "$baseUrl/bookings/$($booking1.id)/reschedule" -Method Post -Body $body -Headers $zhangsanHeaders -ContentType "application/json"
}

# ==================== 场景4: 时段冲突 (400) ====================
$null = Test-Success "创建冲突时段预约 (lisi)" {
    $body = @{
        venueId = $venue.id
        date = $testDate2
        startTime = "10:00"
        endTime = "12:00"
        purpose = "回归测试-冲突"
    } | ConvertTo-Json
    Invoke-RestMethod "$baseUrl/bookings" -Method Post -Body $body -Headers $lisiHeaders -ContentType "application/json"
}

$scenario4 = Test-Scenario "4. 时段冲突 (改期到已占用时段) (期望 400)" 400 {
    $body = @{
        newDate = $testDate2
        newStartTime = "10:30"
        newEndTime = "11:30"
        reason = "冲突改期"
    } | ConvertTo-Json
    Invoke-RestMethod "$baseUrl/bookings/$($booking1.id)/reschedule" -Method Post -Body $body -Headers $zhangsanHeaders -ContentType "application/json"
}

# ==================== 汇总结果 ====================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  测试结果汇总" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$allPassed = $scenario1[0] -and $scenario2 -and $scenario3 -and $scenario4

Write-Host ""
if ($scenario1[0]) { Write-Host "1. 本人正常改期 (200): PASS ✓" -ForegroundColor Green } else { Write-Host "1. 本人正常改期 (200): FAIL ✗" -ForegroundColor Red }
if ($scenario2) { Write-Host "2. 越权改期 (403):    PASS ✓" -ForegroundColor Green } else { Write-Host "2. 越权改期 (403):    FAIL ✗" -ForegroundColor Red }
if ($scenario3) { Write-Host "3. 非法时间 (400):    PASS ✓" -ForegroundColor Green } else { Write-Host "3. 非法时间 (400):    FAIL ✗" -ForegroundColor Red }
if ($scenario4) { Write-Host "4. 时段冲突 (400):    PASS ✓" -ForegroundColor Green } else { Write-Host "4. 时段冲突 (400):    FAIL ✗" -ForegroundColor Red }

Write-Host ""
if ($allPassed) {
    Write-Host "  所有测试通过 ✓" -ForegroundColor Green
} else {
    Write-Host "  部分测试失败 ✗" -ForegroundColor Red
    exit 1
}
Write-Host ""
Write-Host "复跑步骤:" -ForegroundColor Cyan
Write-Host "  1. 确保后端服务运行在 http://localhost:3001" -ForegroundColor Gray
Write-Host "  2. 在 PowerShell 中执行: .\test-reschedule-status-codes.ps1" -ForegroundColor Gray
Write-Host "  3. 关键期望:" -ForegroundColor Gray
Write-Host "     - 本人正常改期: 返回 200" -ForegroundColor Gray
Write-Host "     - 越权改期: 返回 403 Forbidden" -ForegroundColor Gray
Write-Host "     - 非法时间范围: 返回 400 Bad Request" -ForegroundColor Gray
Write-Host "     - 时段冲突: 返回 400 Bad Request" -ForegroundColor Gray
Write-Host ""
