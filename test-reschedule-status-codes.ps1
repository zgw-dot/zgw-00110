$baseUrl = "http://localhost:3001/api"
$ErrorActionPreference = "Stop"

$runId = Get-Date -Format "yyyyMMddHHmmss"
$testPurposePrefix = "regression-$runId"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  改期越权状态码回归测试" -ForegroundColor Cyan
Write-Host "  运行ID: $runId" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ==================== 辅助函数 ====================
function Login($username, $password) {
    $body = @{ username = $username; password = $password } | ConvertTo-Json
    try {
        $resp = Invoke-RestMethod "$baseUrl/auth/login" -Method Post -Body $body -ContentType "application/json"
        return @{ "Authorization" = "Bearer $($resp.token)" }
    } catch {
        Write-Host "  登录失败: $username / $password" -ForegroundColor Red
        Write-Host "  错误: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

function Invoke-Api($method, $path, $headers, $body = $null) {
    try {
        if ($body) {
            return Invoke-RestMethod "$baseUrl$path" -Method $method -Headers $headers -Body $body -ContentType "application/json"
        } else {
            return Invoke-RestMethod "$baseUrl$path" -Method $method -Headers $headers
        }
    } catch {
        throw
    }
}

function Assert-Success($name, $result) {
    if (-not $result[0]) {
        Write-Host ""
        Write-Host "前置步骤失败: $name" -ForegroundColor Red
        Write-Host "测试中止，请检查后端服务是否正常，或使用更远日期重试" -ForegroundColor Red
        exit 1
    }
    return $result[1]
}

function Test-Success($name, $scriptBlock) {
    Write-Host "步骤: $name" -ForegroundColor Yellow
    try {
        $result = & $scriptBlock
        Write-Host "  状态码: 200" -ForegroundColor Gray
        Write-Host "  PASS ✓" -ForegroundColor Green
        return @($true, $result)
    } catch {
        $actualStatus = $_.Exception.Response.StatusCode.value__
        $errorMsg = $_.ErrorDetails.Message
        Write-Host "  状态码: $actualStatus" -ForegroundColor Gray
        if ($errorMsg) {
            try {
                $msg = ($errorMsg | ConvertFrom-Json).error
            } catch {
                $msg = $errorMsg
            }
            Write-Host "  错误: $msg" -ForegroundColor Gray
        }
        Write-Host "  FAIL ✗" -ForegroundColor Red
        return @($false, $null)
    }
}

function Test-Scenario($name, $expectedStatus, $scriptBlock) {
    Write-Host "场景: $name" -ForegroundColor Yellow
    Write-Host "  期望: $expectedStatus" -ForegroundColor Gray
    try {
        & $scriptBlock
        Write-Host "  实际: 200 (期望抛出)" -ForegroundColor Red
        Write-Host "  FAIL ✗" -ForegroundColor Red
        return $false
    } catch {
        $actualStatus = $_.Exception.Response.StatusCode.value__
        $errorMsg = $_.ErrorDetails.Message
        try {
            $msg = ($errorMsg | ConvertFrom-Json).error
        } catch {
            $msg = $errorMsg
        }
        Write-Host "  实际: $actualStatus" -ForegroundColor Gray
        Write-Host "  错误: $msg" -ForegroundColor Gray
        if ($actualStatus -eq $expectedStatus) {
            Write-Host "  PASS ✓" -ForegroundColor Green
            return $true
        } else {
            Write-Host "  FAIL ✗ - 状态码不匹配" -ForegroundColor Red
            return $false
        }
    }
}

function Find-AvailableSlot($venueId, $headers, $startDays = 60, $timeSlots = @("08:00-10:00", "10:00-12:00", "12:00-14:00", "14:00-16:00", "16:00-18:00")) {
    for ($days = $startDays; $days -lt $startDays + 30; $days++) {
        $date = (Get-Date).AddDays($days).ToString("yyyy-MM-dd")
        try {
            $bookings = Invoke-Api "GET" "/calendar?venueId=$venueId&startDate=$date&endDate=$date" $headers
            foreach ($slot in $timeSlots) {
                $start, $end = $slot -split "-"
                $conflict = $false
                foreach ($b in $bookings) {
                    if ($b.start_time -lt $end -and $b.end_time -gt $start) {
                        $conflict = $true
                        break
                    }
                }
                if (-not $conflict) {
                    return @($date, $start, $end)
                }
            }
        } catch {
            Write-Host "  查询日历失败: $date" -ForegroundColor Red
        }
    }
    Write-Host "  错误: 30天内未找到可用时段" -ForegroundColor Red
    exit 1
}

# ==================== 初始化 ====================
Write-Host "--- 初始化 ---" -ForegroundColor Cyan

$zhangsanHeaders = Login "zhangsan" "user123"
$lisiHeaders = Login "lisi" "user123"
$adminHeaders = Login "admin" "admin123"
Write-Host "  登录成功" -ForegroundColor Gray

$venues = Invoke-Api "GET" "/venues" $zhangsanHeaders
$venue = $venues | Where-Object { $_.deposit_amount -eq 0 } | Select-Object -First 1
if (-not $venue) {
    Write-Host "  错误: 未找到押金为0的场地" -ForegroundColor Red
    exit 1
}
Write-Host "  使用场地: $($venue.name) (ID: $($venue.id.Substring(0,8))...)" -ForegroundColor Gray

# ==================== 查找可用时段 ====================
Write-Host ""
Write-Host "--- 查找可用时段 ---" -ForegroundColor Cyan

$startOffset = 100 + ([int]$runId.Substring(10, 4) % 50)
Write-Host "  日期偏移: +$startOffset 天" -ForegroundColor Gray

$slot1 = Find-AvailableSlot $venue.id $zhangsanHeaders $startOffset
$date1, $start1, $end1 = $slot1
Write-Host "  时段1: $date1 $start1-$end1" -ForegroundColor Gray

$slot2 = Find-AvailableSlot $venue.id $zhangsanHeaders ($startOffset + 5)
$date2, $start2, $end2 = $slot2
Write-Host "  时段2: $date2 $start2-$end2" -ForegroundColor Gray

$slot3 = Find-AvailableSlot $venue.id $zhangsanHeaders ($startOffset + 10)
$date3, $start3, $end3 = $slot3
Write-Host "  时段3: $date3 $start3-$end3" -ForegroundColor Gray

# ==================== 场景1: 本人正常改期 (200) ====================
Write-Host ""
Write-Host "--- 测试场景 ---" -ForegroundColor Cyan

$r = Test-Success "创建预约1 (zhangsan)" {
    $body = @{
        venueId = $venue.id
        date = $date1
        startTime = $start1
        endTime = $end1
        purpose = "$testPurposePrefix-正常改期"
    } | ConvertTo-Json
    Invoke-Api "POST" "/bookings" $zhangsanHeaders $body
}
$booking1 = Assert-Success "创建预约1" $r

$r = Test-Success "审批预约1" {
    Invoke-Api "POST" "/bookings/$($booking1.id)/approve" $adminHeaders
}
$null = Assert-Success "审批预约1" $r

$scenario1 = Test-Success "1. 本人正常改期 (期望 200)" {
    $body = @{
        newDate = $date2
        newStartTime = $start2
        newEndTime = $end2
        reason = "正常改期原因"
    } | ConvertTo-Json
    Invoke-Api "POST" "/bookings/$($booking1.id)/reschedule" $zhangsanHeaders $body
}
$reschedule1 = Assert-Success "本人正常改期" $scenario1

# 管理员同意改期，避免后续测试因为"已有待处理改期"失败
$r = Test-Success "管理员同意改期1" {
    Invoke-Api "POST" "/bookings/reschedules/$($reschedule1.id)/approve" $adminHeaders
}
$null = Assert-Success "管理员同意改期1" $r

# ==================== 场景2: 越权改期 (403) ====================
$r = Test-Success "创建预约2 (zhangsan)" {
    $body = @{
        venueId = $venue.id
        date = $date3
        startTime = $start3
        endTime = $end3
        purpose = "$testPurposePrefix-越权改期"
    } | ConvertTo-Json
    Invoke-Api "POST" "/bookings" $zhangsanHeaders $body
}
$booking2 = Assert-Success "创建预约2" $r

$r = Test-Success "审批预约2" {
    Invoke-Api "POST" "/bookings/$($booking2.id)/approve" $adminHeaders
}
$null = Assert-Success "审批预约2" $r

$scenario2 = Test-Scenario "2. 越权改期 (lisi 改 zhangsan 的预约) (期望 403)" 403 {
    $body = @{
        newDate = $date2
        newStartTime = "10:00"
        newEndTime = "12:00"
        reason = "越权改期"
    } | ConvertTo-Json
    Invoke-Api "POST" "/bookings/$($booking2.id)/reschedule" $lisiHeaders $body
}

# ==================== 场景3: 非法时间 (400) ====================
$scenario3 = Test-Scenario "3. 非法时间范围 (结束早于开始) (期望 400)" 400 {
    $body = @{
        newDate = $date2
        newStartTime = "16:00"
        newEndTime = "14:00"
        reason = "非法时间"
    } | ConvertTo-Json
    Invoke-Api "POST" "/bookings/$($booking1.id)/reschedule" $zhangsanHeaders $body
}

# ==================== 场景4: 时段冲突 (400) ====================
# 动态查找可用时段创建冲突预约（在改期完成后查找，避免时段冲突）
$slot4 = Find-AvailableSlot $venue.id $zhangsanHeaders ($startOffset + 15) @("08:00-10:00", "10:00-12:00")
$date4, $start4, $end4 = $slot4
Write-Host "  冲突时段: $date4 $start4-$end4" -ForegroundColor Gray

$r = Test-Success "创建冲突预约 (lisi)" {
    $body = @{
        venueId = $venue.id
        date = $date4
        startTime = $start4
        endTime = $end4
        purpose = "$testPurposePrefix-冲突"
    } | ConvertTo-Json
    Invoke-Api "POST" "/bookings" $lisiHeaders $body
}
$null = Assert-Success "创建冲突预约" $r

# 计算一个与冲突预约重叠的时段
$conflictStart = $start4
$conflictEnd = $end4
# 取中间半小时
$h1, $m1 = $start4 -split ":"
$h2, $m2 = $end4 -split ":"
$totalStart = [int]$h1 * 60 + [int]$m1
$totalEnd = [int]$h2 * 60 + [int]$m2
$mid = ($totalStart + $totalEnd) / 2
$conflictStart = "{0:D2}:{1:D2}" -f [math]::Floor($mid / 60), [int]($mid % 60)
$conflictEnd = "{0:D2}:{1:D2}" -f [math]::Floor(($mid + 30) / 60), [int](($mid + 30) % 60)

$scenario4 = Test-Scenario "4. 时段冲突 (改期到已占用时段) (期望 400)" 400 {
    $body = @{
        newDate = $date4
        newStartTime = $conflictStart
        newEndTime = $conflictEnd
        reason = "冲突改期"
    } | ConvertTo-Json
    Invoke-Api "POST" "/bookings/$($booking1.id)/reschedule" $zhangsanHeaders $body
}

# ==================== 汇总结果 ====================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  测试结果汇总 (运行ID: $runId)" -ForegroundColor Cyan
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
    Write-Host "  (测试数据 purpose 前缀: $testPurposePrefix)" -ForegroundColor Gray
} else {
    Write-Host "  部分测试失败 ✗" -ForegroundColor Red
    exit 1
}
Write-Host ""
Write-Host "复跑步骤:" -ForegroundColor Cyan
Write-Host "  1. 确保后端服务运行在 http://localhost:3001" -ForegroundColor Gray
Write-Host "  2. PowerShell 执行: .\test-reschedule-status-codes.ps1" -ForegroundColor Gray
Write-Host "  3. 可连续多次运行，每次自动查找可用时段，无需清理数据库" -ForegroundColor Gray
Write-Host ""
Write-Host "关键期望:" -ForegroundColor Cyan
Write-Host "  - 本人正常改期: 200 OK" -ForegroundColor Gray
Write-Host "  - 越权改期: 403 Forbidden" -ForegroundColor Gray
Write-Host "  - 非法时间范围: 400 Bad Request" -ForegroundColor Gray
Write-Host "  - 时段冲突: 400 Bad Request" -ForegroundColor Gray
Write-Host ""
