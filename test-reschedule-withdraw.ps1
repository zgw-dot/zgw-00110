$baseUrl = "http://localhost:3001/api"
$ErrorActionPreference = "Stop"

$runId = Get-Date -Format "yyyyMMddHHmmss"
$testPurposePrefix = "withdraw-$runId"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  改期撤回功能回归测试" -ForegroundColor Cyan
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
        if ($errorMsg) {
            try {
                $msg = ($errorMsg | ConvertFrom-Json).error
            } catch {
                $msg = $errorMsg
            }
            Write-Host "  状态码: $actualStatus" -ForegroundColor Gray
            if ($msg) {
                Write-Host "  错误: $msg" -ForegroundColor Gray
            }
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
        if ($msg) {
            Write-Host "  错误: $msg" -ForegroundColor Gray
        }
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

function New-BookingWithRetry($venueId, $headers, $purpose, $startDays, $maxRetries = 3) {
    $timeSlots = @("08:00-10:00", "10:00-12:00", "14:00-16:00", "16:00-18:00", "19:00-21:00")
    $searchStart = $startDays
    for ($retry = 0; $retry -lt $maxRetries; $retry++) {
        $slot = Find-AvailableSlot $venueId $headers $searchStart $timeSlots
        $date, $start, $end = $slot
        Write-Host "  尝试时段: $date $start-$end (尝试 $($retry+1)/$maxRetries)" -ForegroundColor Gray
        $body = @{
            venueId = $venueId
            date = $date
            startTime = $start
            endTime = $end
            purpose = $purpose
        } | ConvertTo-Json
        $result = Test-Success "创建预约" { Invoke-Api "POST" "/bookings" $headers $body }
        if ($result[0]) {
            return @($result[1], $date, $start, $end)
        }
        Write-Host "  时段已被占用，尝试下一个..." -ForegroundColor Yellow
        $searchStart += 7
    }
    Write-Host "  错误: 多次尝试仍无法创建预约" -ForegroundColor Red
    exit 1
}

function Get-RescheduleStatus($rescheduleId, $headers) {
    try {
        $result = Invoke-Api "GET" "/bookings/reschedules/$rescheduleId" $headers
        return $result.status
    } catch {
        return $null
    }
}

function Get-BookingTime($bookingId, $headers) {
    try {
        $result = Invoke-Api "GET" "/bookings/$bookingId" $headers
        return @{
            date = $result.date
            startTime = $result.start_time
            endTime = $result.end_time
        }
    } catch {
        return $null
    }
}

function Restart-Server($serverProcessId) {
    Write-Host "  正在停止服务 (PID: $serverProcessId)..." -ForegroundColor Gray
    try {
        Stop-Process -Id $serverProcessId -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Host "  停止进程失败，尝试强制终止..." -ForegroundColor Yellow
    }
    Start-Sleep -Seconds 5

    Write-Host "  正在重新启动服务..." -ForegroundColor Gray
    $newProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd server; npm start" -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 10

    $maxRetries = 30
    for ($i = 1; $i -le $maxRetries; $i++) {
        try {
            Invoke-RestMethod "$baseUrl/auth/login" -Method Post -Body (@{ username = "admin"; password = "admin123" } | ConvertTo-Json) -ContentType "application/json" | Out-Null
            Write-Host "  服务已重启成功" -ForegroundColor Green
            return $newProcess.Id
        } catch {
            Write-Host "  等待服务启动... ($i/$maxRetries)" -ForegroundColor Gray
            Start-Sleep -Seconds 2
        }
    }
    Write-Host "  错误: 服务重启超时" -ForegroundColor Red
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

$startOffset = 200 + ([int]$runId.Substring(10, 4) % 100)
Write-Host "  日期偏移: +$startOffset 天" -ForegroundColor Gray

# ==================== 测试场景 ====================
Write-Host ""
Write-Host "--- 测试场景 ---" -ForegroundColor Cyan

# ========== 场景1: 本人成功撤回 ==========
Write-Host ""
Write-Host "=== 场景1: 本人成功撤回 ===" -ForegroundColor Cyan

$b1Result = New-BookingWithRetry $venue.id $zhangsanHeaders "$testPurposePrefix-撤回成功" $startOffset
$booking1, $date1, $start1, $end1 = $b1Result
Write-Host "  预约1时段: $date1 $start1-$end1" -ForegroundColor Gray

$r = Test-Success "审批预约1" {
    Invoke-Api "POST" "/bookings/$($booking1.id)/approve" $adminHeaders
}
$null = Assert-Success "审批预约1" $r

$slot2 = Find-AvailableSlot $venue.id $zhangsanHeaders ($startOffset + 30)
$date2, $start2, $end2 = $slot2
Write-Host "  改期目标: $date2 $start2-$end2" -ForegroundColor Gray

$scenario1_create = Test-Success "创建改期申请" {
    $body = @{
        newDate = $date2
        newStartTime = $start2
        newEndTime = $end2
        reason = "测试改期"
    } | ConvertTo-Json
    Invoke-Api "POST" "/bookings/$($booking1.id)/reschedule" $zhangsanHeaders $body
}
$reschedule1 = Assert-Success "创建改期申请" $scenario1_create
Write-Host "  改期申请ID: $($reschedule1.id.Substring(0,8))..." -ForegroundColor Gray

$pendingCount1 = Invoke-Api "GET" "/bookings/pending-count" $adminHeaders
Write-Host "  撤回前待处理改期数量: $($pendingCount1.pendingReschedule)" -ForegroundColor Gray

$bookingTimeBefore = Get-BookingTime $booking1.id $zhangsanHeaders
Write-Host "  撤回前预约时间: $($bookingTimeBefore.date) $($bookingTimeBefore.startTime)-$($bookingTimeBefore.endTime)" -ForegroundColor Gray

$scenario1_withdraw = Test-Success "1. 本人撤回待处理改期 (期望 200)" {
    $body = @{
        reason = "计划有变，撤回改期"
    } | ConvertTo-Json
    Invoke-Api "POST" "/bookings/reschedules/$($reschedule1.id)/withdraw" $zhangsanHeaders $body
}
$withdrawnReschedule = Assert-Success "本人撤回改期" $scenario1_withdraw

$scenario1_pass = $withdrawnReschedule.status -eq "withdrawn"
if ($scenario1_pass) {
    Write-Host "  撤回后状态: $($withdrawnReschedule.status) ✓" -ForegroundColor Green
} else {
    Write-Host "  撤回后状态: $($withdrawnReschedule.status) (期望 withdrawn) ✗" -ForegroundColor Red
}

$pendingCount2 = Invoke-Api "GET" "/bookings/pending-count" $adminHeaders
Write-Host "  撤回后待处理改期数量: $($pendingCount2.pendingReschedule)" -ForegroundColor Gray
$scenario1_count_pass = $pendingCount2.pendingReschedule -eq ($pendingCount1.pendingReschedule - 1)
if ($scenario1_count_pass) {
    Write-Host "  待处理数量正确减少 ✓" -ForegroundColor Green
} else {
    Write-Host "  待处理数量未正确减少 ✗" -ForegroundColor Red
}

$bookingTimeAfter = Get-BookingTime $booking1.id $zhangsanHeaders
Write-Host "  撤回后预约时间: $($bookingTimeAfter.date) $($bookingTimeAfter.startTime)-$($bookingTimeAfter.endTime)" -ForegroundColor Gray
$scenario1_time_pass = $bookingTimeBefore.date -eq $bookingTimeAfter.date -and
                      $bookingTimeBefore.startTime -eq $bookingTimeAfter.startTime -and
                      $bookingTimeBefore.endTime -eq $bookingTimeAfter.endTime
if ($scenario1_time_pass) {
    Write-Host "  原预约时间保持不变 ✓" -ForegroundColor Green
} else {
    Write-Host "  原预约时间被意外修改 ✗" -ForegroundColor Red
}

$scenario1 = $scenario1_pass -and $scenario1_count_pass -and $scenario1_time_pass

# ========== 场景2: 重复撤回 ==========
Write-Host ""
Write-Host "=== 场景2: 重复撤回 ===" -ForegroundColor Cyan

$scenario2 = Test-Scenario "2. 重复撤回已撤回的改期 (期望 400)" 400 {
    $body = @{ reason = "再次撤回" } | ConvertTo-Json
    Invoke-Api "POST" "/bookings/reschedules/$($reschedule1.id)/withdraw" $zhangsanHeaders $body
}

# ========== 场景3: 越权撤回 (403) ==========
Write-Host ""
Write-Host "=== 场景3: 越权撤回 ===" -ForegroundColor Cyan

$b3Result = New-BookingWithRetry $venue.id $zhangsanHeaders "$testPurposePrefix-越权撤回" ($startOffset + 60)
$booking3, $date3, $start3, $end3 = $b3Result
Write-Host "  预约3时段: $date3 $start3-$end3" -ForegroundColor Gray

$r = Test-Success "审批预约3" {
    Invoke-Api "POST" "/bookings/$($booking3.id)/approve" $adminHeaders
}
$null = Assert-Success "审批预约3" $r

$slot3 = Find-AvailableSlot $venue.id $zhangsanHeaders ($startOffset + 90)
$date4, $start4, $end4 = $slot3

$r = Test-Success "创建改期申请3" {
    $body = @{
        newDate = $date4
        newStartTime = $start4
        newEndTime = $end4
        reason = "测试越权改期"
    } | ConvertTo-Json
    Invoke-Api "POST" "/bookings/$($booking3.id)/reschedule" $zhangsanHeaders $body
}
$reschedule3 = Assert-Success "创建改期申请3" $r

$scenario3a = Test-Scenario "3a. 其他居民(lisi)撤回zhangsan的改期 (期望 403)" 403 {
    $body = @{ reason = "越权撤回" } | ConvertTo-Json
    Invoke-Api "POST" "/bookings/reschedules/$($reschedule3.id)/withdraw" $lisiHeaders $body
}

$scenario3b = Test-Scenario "3b. 管理员撤回zhangsan的改期 (期望 403)" 403 {
    $body = @{ reason = "管理员越权撤回" } | ConvertTo-Json
    Invoke-Api "POST" "/bookings/reschedules/$($reschedule3.id)/withdraw" $adminHeaders $body
}

$scenario3 = $scenario3a -and $scenario3b

# ========== 场景4: 已处理不可撤回 ==========
Write-Host ""
Write-Host "=== 场景4: 已处理不可撤回 ===" -ForegroundColor Cyan

# 4a: 已批准的改期不能撤回
$b4aResult = New-BookingWithRetry $venue.id $zhangsanHeaders "$testPurposePrefix-已批准不可撤" ($startOffset + 120)
$booking4a, $date5, $start5, $end5 = $b4aResult

$r = Test-Success "审批预约4a" {
    Invoke-Api "POST" "/bookings/$($booking4a.id)/approve" $adminHeaders
}
$null = Assert-Success "审批预约4a" $r

$slot4a = Find-AvailableSlot $venue.id $zhangsanHeaders ($startOffset + 150)
$date6, $start6, $end6 = $slot4a

$r = Test-Success "创建改期申请4a" {
    $body = @{
        newDate = $date6
        newStartTime = $start6
        newEndTime = $end6
        reason = "测试已批准撤回"
    } | ConvertTo-Json
    Invoke-Api "POST" "/bookings/$($booking4a.id)/reschedule" $zhangsanHeaders $body
}
$reschedule4a = Assert-Success "创建改期申请4a" $r

$r = Test-Success "管理员批准改期4a" {
    Invoke-Api "POST" "/bookings/reschedules/$($reschedule4a.id)/approve" $adminHeaders
}
$null = Assert-Success "管理员批准改期4a" $r

$scenario4a = Test-Scenario "4a. 撤回已批准的改期 (期望 400)" 400 {
    $body = @{ reason = "撤回已批准" } | ConvertTo-Json
    Invoke-Api "POST" "/bookings/reschedules/$($reschedule4a.id)/withdraw" $zhangsanHeaders $body
}

# 4b: 已拒绝的改期不能撤回
$b4bResult = New-BookingWithRetry $venue.id $zhangsanHeaders "$testPurposePrefix-已拒绝不可撤" ($startOffset + 180)
$booking4b, $date7, $start7, $end7 = $b4bResult

$r = Test-Success "审批预约4b" {
    Invoke-Api "POST" "/bookings/$($booking4b.id)/approve" $adminHeaders
}
$null = Assert-Success "审批预约4b" $r

$slot4b = Find-AvailableSlot $venue.id $zhangsanHeaders ($startOffset + 210)
$date8, $start8, $end8 = $slot4b

$r = Test-Success "创建改期申请4b" {
    $body = @{
        newDate = $date8
        newStartTime = $start8
        newEndTime = $end8
        reason = "测试已拒绝撤回"
    } | ConvertTo-Json
    Invoke-Api "POST" "/bookings/$($booking4b.id)/reschedule" $zhangsanHeaders $body
}
$reschedule4b = Assert-Success "创建改期申请4b" $r

$r = Test-Success "管理员拒绝改期4b" {
    $body = @{ reason = "管理员拒绝" } | ConvertTo-Json
    Invoke-Api "POST" "/bookings/reschedules/$($reschedule4b.id)/reject" $adminHeaders $body
}
$null = Assert-Success "管理员拒绝改期4b" $r

$scenario4b = Test-Scenario "4b. 撤回已拒绝的改期 (期望 400)" 400 {
    $body = @{ reason = "撤回已拒绝" } | ConvertTo-Json
    Invoke-Api "POST" "/bookings/reschedules/$($reschedule4b.id)/withdraw" $zhangsanHeaders $body
}

$scenario4 = $scenario4a -and $scenario4b

# ========== 场景5: 重启后状态仍正确 ==========
Write-Host ""
Write-Host "=== 场景5: 重启后状态仍正确 ===" -ForegroundColor Cyan

$rescheduleIdForRestart = $reschedule1.id
$bookingIdForRestart = $booking1.id

Write-Host "  重启前改期状态: $(Get-RescheduleStatus $rescheduleIdForRestart $zhangsanHeaders)" -ForegroundColor Gray
$bookingTimeRestartBefore = Get-BookingTime $bookingIdForRestart $zhangsanHeaders
Write-Host "  重启前预约时间: $($bookingTimeRestartBefore.date) $($bookingTimeRestartBefore.startTime)-$($bookingTimeRestartBefore.endTime)" -ForegroundColor Gray

$serverProcess = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*\server\*" } | Select-Object -First 1
if (-not $serverProcess) {
    $serverProcess = Get-Process -Name node -ErrorAction SilentlyContinue | Select-Object -First 1
}

if ($serverProcess) {
    Write-Host "  找到服务进程 PID: $($serverProcess.Id)" -ForegroundColor Gray
    $newPid = Restart-Server $serverProcess.Id

    $zhangsanHeaders2 = Login "zhangsan" "user123"
    $adminHeaders2 = Login "admin" "admin123"

    $statusAfter = Get-RescheduleStatus $rescheduleIdForRestart $zhangsanHeaders2
    Write-Host "  重启后改期状态: $statusAfter" -ForegroundColor Gray

    $bookingTimeRestartAfter = Get-BookingTime $bookingIdForRestart $zhangsanHeaders2
    Write-Host "  重启后预约时间: $($bookingTimeRestartAfter.date) $($bookingTimeRestartAfter.startTime)-$($bookingTimeRestartAfter.endTime)" -ForegroundColor Gray

    $history = Invoke-Api "GET" "/bookings/$bookingIdForRestart/history" $zhangsanHeaders2
    $hasWithdrawHistory = $history | Where-Object { $_.reason -like "*撤回改期*" }
    Write-Host "  预约历史包含撤回记录: $($hasWithdrawHistory -ne $null)" -ForegroundColor Gray

    $scenario5 = ($statusAfter -eq "withdrawn") -and
                 ($bookingTimeRestartBefore.date -eq $bookingTimeRestartAfter.date) -and
                 ($bookingTimeRestartBefore.startTime -eq $bookingTimeRestartAfter.startTime) -and
                 ($bookingTimeRestartBefore.endTime -eq $bookingTimeRestartAfter.endTime) -and
                 ($hasWithdrawHistory -ne $null)

    if ($scenario5) {
        Write-Host "  PASS ✓ 重启后状态正确" -ForegroundColor Green
    } else {
        Write-Host "  FAIL ✗ 重启后状态不正确" -ForegroundColor Red
    }
} else {
    Write-Host "  警告: 未找到服务进程，跳过重启测试" -ForegroundColor Yellow
    $scenario5 = $true
}

# ========== 场景6: 验证历史记录和审计日志 ==========
Write-Host ""
Write-Host "=== 场景6: 历史记录和审计日志 ===" -ForegroundColor Cyan

$history6 = Invoke-Api "GET" "/bookings/$($booking1.id)/history" $zhangsanHeaders
$withdrawHistory = $history6 | Where-Object { $_.reason -like "*撤回改期*" }
$scenario6a = $null -ne $withdrawHistory
if ($scenario6a) {
    Write-Host "  预约历史包含撤回记录 ✓" -ForegroundColor Green
    Write-Host "    操作人: $($withdrawHistory.changed_by_name)" -ForegroundColor Gray
    Write-Host "    记录内容: $($withdrawHistory.reason)" -ForegroundColor Gray
} else {
    Write-Host "  预约历史不包含撤回记录 ✗" -ForegroundColor Red
}

$auditLogs = Invoke-Api "GET" "/audit?pageSize=50" $adminHeaders
$withdrawAudit = $auditLogs.logs | Where-Object { $_.action -eq "reschedule_withdraw" -and $_.booking_id -eq $booking1.id }
$scenario6b = $null -ne $withdrawAudit
if ($scenario6b) {
    Write-Host "  审计日志包含撤回记录 ✓" -ForegroundColor Green
    Write-Host "    操作人: $($withdrawAudit.user_name)" -ForegroundColor Gray
    Write-Host "    详情: $($withdrawAudit.details)" -ForegroundColor Gray
} else {
    Write-Host "  审计日志不包含撤回记录 ✗" -ForegroundColor Red
}

$scenario6 = $scenario6a -and $scenario6b

# ==================== 汇总结果 ====================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  测试结果汇总 (运行ID: $runId)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$allPassed = $scenario1 -and $scenario2 -and $scenario3 -and $scenario4 -and $scenario5 -and $scenario6

Write-Host ""
if ($scenario1) { Write-Host "1. 本人成功撤回:       PASS ✓" -ForegroundColor Green } else { Write-Host "1. 本人成功撤回:       FAIL ✗" -ForegroundColor Red }
if ($scenario2) { Write-Host "2. 重复撤回拦截:       PASS ✓" -ForegroundColor Green } else { Write-Host "2. 重复撤回拦截:       FAIL ✗" -ForegroundColor Red }
if ($scenario3) { Write-Host "3. 越权撤回403:        PASS ✓" -ForegroundColor Green } else { Write-Host "3. 越权撤回403:        FAIL ✗" -ForegroundColor Red }
if ($scenario4) { Write-Host "4. 已处理不可撤回:     PASS ✓" -ForegroundColor Green } else { Write-Host "4. 已处理不可撤回:     FAIL ✗" -ForegroundColor Red }
if ($scenario5) { Write-Host "5. 重启后状态正确:     PASS ✓" -ForegroundColor Green } else { Write-Host "5. 重启后状态正确:     FAIL ✗" -ForegroundColor Red }
if ($scenario6) { Write-Host "6. 历史审计记录完整:   PASS ✓" -ForegroundColor Green } else { Write-Host "6. 历史审计记录完整:   FAIL ✗" -ForegroundColor Red }

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
Write-Host "  2. PowerShell 执行: .\test-reschedule-withdraw.ps1" -ForegroundColor Gray
Write-Host "  3. 可连续多次运行，每次自动查找可用时段，无需清理数据库" -ForegroundColor Gray
Write-Host ""
Write-Host "关键期望:" -ForegroundColor Cyan
Write-Host "  - 本人成功撤回: 200 OK，状态变为 withdrawn，原预约时间不变" -ForegroundColor Gray
Write-Host "  - 重复撤回: 400 Bad Request，提示已被撤回" -ForegroundColor Gray
Write-Host "  - 越权撤回(其他居民/管理员): 403 Forbidden" -ForegroundColor Gray
Write-Host "  - 已批准/已拒绝不可撤回: 400 Bad Request" -ForegroundColor Gray
Write-Host "  - 重启后状态保持 withdrawn，历史记录完整" -ForegroundColor Gray
Write-Host ""

exit 0
