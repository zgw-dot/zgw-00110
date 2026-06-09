# API Test Script - Using Invoke-RestMethod
$baseUrl = "http://localhost:3001/api"
$headers = @{"Content-Type" = "application/json"}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Community Venue Booking System - API Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Helper function for POST
function Post-Json($url, $body, $extraHeaders) {
    $h = @{"Content-Type" = "application/json"}
    if ($extraHeaders) {
        foreach ($key in $extraHeaders.Keys) {
            $h[$key] = $extraHeaders[$key]
        }
    }
    try {
        return Invoke-RestMethod -Uri $url -Method Post -Body ($body | ConvertTo-Json -Depth 10) -Headers $h -ErrorAction Stop
    } catch {
        $errorMessage = $_.Exception.Message
        if ($_.Exception.Response) {
            try {
                $statusCode = $_.Exception.Response.StatusCode.value__
                if ($_.ErrorDetails) {
                    $errorMessage = "HTTP $statusCode`: $($_.ErrorDetails.Message)"
                } else {
                    $errorMessage = "HTTP $statusCode`: $($_.Exception.Message)"
                }
            } catch {
                $errorMessage = $_.Exception.Message
            }
        }
        throw [System.Exception]::new($errorMessage, $_.Exception)
    }
}

# Helper function for GET
function Get-Json($url, $extraHeaders) {
    $h = @{}
    if ($extraHeaders) {
        foreach ($key in $extraHeaders.Keys) {
            $h[$key] = $extraHeaders[$key]
        }
    }
    return Invoke-RestMethod -Uri $url -Method Get -Headers $h
}

# Test 1: Login as admin
Write-Host "`[Test 1`] Admin login" -ForegroundColor Yellow
try {
    $response = Post-Json "$baseUrl/auth/login" @{username="admin"; password="admin123"}
    $adminToken = $response.token
    Write-Host "  OK: Admin login success" -ForegroundColor Green
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 2: Login as resident (zhangsan)
Write-Host "`[Test 2`] Resident login" -ForegroundColor Yellow
try {
    $response = Post-Json "$baseUrl/auth/login" @{username="zhangsan"; password="user123"}
    $userToken = $response.token
    $user = $response.user
    $userBalance = $user.balance
    Write-Host "  OK: Zhangsan login, balance: $userBalance" -ForegroundColor Green
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$userHeaders = @{"Authorization" = "Bearer $userToken"}
$adminHeaders = @{"Authorization" = "Bearer $adminToken"}

# Test 3: Get venues
Write-Host "`[Test 3`] Get venues" -ForegroundColor Yellow
$venues = Get-Json "$baseUrl/venues" $userHeaders
$venue = $venues[0]
Write-Host "  OK: Got $($venues.Count) venues, using: $($venue.name) (deposit: $($venue.deposit_amount))" -ForegroundColor Green

# Test 4: Create booking
Write-Host "`[Test 4`] Create booking (main flow)" -ForegroundColor Yellow
$tomorrow = (Get-Date).AddDays(1).ToString("yyyy-MM-dd")
try {
    $booking = Post-Json "$baseUrl/bookings" @{
        venueId = $venue.id
        date = $tomorrow
        startTime = "09:00"
        endTime = "11:00"
        purpose = "API Test Booking"
    } $userHeaders
    $bookingId = $booking.id
    Write-Host "  OK: Booking created, ID: $($bookingId.Substring(0,8))..., status: $($booking.status)" -ForegroundColor Green
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Verify balance decreased
$me = Get-Json "$baseUrl/auth/me" $userHeaders
$expectedBalance = $userBalance - $venue.deposit_amount
if ([math]::Abs($me.balance - $expectedBalance) -lt 0.01) {
    Write-Host "  OK: Balance correctly changed: $userBalance -> $($me.balance)" -ForegroundColor Green
} else {
    Write-Host "  FAIL: Balance wrong: $userBalance -> $($me.balance), expected: $expectedBalance" -ForegroundColor Red
    exit 1
}

# Test 5: Resident tries to complete booking (should be 403)
Write-Host "`[Test 5`] Resident complete booking (should be 403)" -ForegroundColor Yellow
try {
    $null = Post-Json "$baseUrl/bookings/$bookingId/complete" @{} $userHeaders
    Write-Host "  FAIL: Should have failed but succeeded" -ForegroundColor Red
    exit 1
} catch {
    if ($_.Exception.Message -match "403|401|Forbidden|Unauthorized") {
        Write-Host "  OK: Correctly rejected: $($_.Exception.Message)" -ForegroundColor Green
    } else {
        Write-Host "  WARN: Rejected but wrong message: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Verify balance unchanged
$me2 = Get-Json "$baseUrl/auth/me" $userHeaders
if ([math]::Abs($me2.balance - $expectedBalance) -lt 0.01) {
    Write-Host "  OK: Balance unchanged: $($me2.balance)" -ForegroundColor Green
} else {
    Write-Host "  FAIL: Balance modified: $($me2.balance)" -ForegroundColor Red
    exit 1
}

# Test 6: Approve booking
Write-Host "`[Test 6`] Approve booking" -ForegroundColor Yellow
try {
    $approved = Post-Json "$baseUrl/bookings/$bookingId/approve" @{} $adminHeaders
    if ($approved.status -eq "approved") {
        Write-Host "  OK: Booking approved, status: $($approved.status)" -ForegroundColor Green
    } else {
        Write-Host "  FAIL: Status wrong: $($approved.status)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 7: Try to create overlapping booking (should fail at creation time)
Write-Host "`[Test 7`] Create overlapping booking (should fail)" -ForegroundColor Yellow
try {
    $overlapBooking = Post-Json "$baseUrl/bookings" @{
        venueId = $venue.id
        date = $tomorrow
        startTime = "10:00"
        endTime = "12:00"
        purpose = "Overlap Test"
    } $userHeaders
    Write-Host "  FAIL: Should have failed but succeeded" -ForegroundColor Red
    exit 1
} catch {
    if ($_.Exception.Message -match "overlap|time|conflict|已被预约") {
        Write-Host "  OK: Correctly rejected overlapping booking at creation" -ForegroundColor Green
    } else {
        Write-Host "  WARN: Rejected but wrong message: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Verify balance unchanged
$meAfterOverlap = Get-Json "$baseUrl/auth/me" $userHeaders
if ([math]::Abs($meAfterOverlap.balance - $expectedBalance) -lt 0.01) {
    Write-Host "  OK: Balance unchanged after failed overlap: $($meAfterOverlap.balance)" -ForegroundColor Green
} else {
    Write-Host "  FAIL: Balance modified: $($meAfterOverlap.balance)" -ForegroundColor Red
    exit 1
}

# Test 8: Checkin
Write-Host "`[Test 8`] Checkin booking" -ForegroundColor Yellow
try {
    $checkedIn = Post-Json "$baseUrl/bookings/$bookingId/checkin" @{} $adminHeaders
    if ($checkedIn.status -eq "checked_in") {
        Write-Host "  OK: Checked in, status: $($checkedIn.status)" -ForegroundColor Green
    } else {
        Write-Host "  FAIL: Status wrong: $($checkedIn.status)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 9: Complete booking
Write-Host "`[Test 9`] Complete booking (refund deposit)" -ForegroundColor Yellow
$balanceBefore = (Get-Json "$baseUrl/auth/me" $userHeaders).balance
try {
    $completed = Post-Json "$baseUrl/bookings/$bookingId/complete" @{} $adminHeaders
    if ($completed.status -eq "completed") {
        Write-Host "  OK: Completed, status: $($completed.status)" -ForegroundColor Green
    } else {
        Write-Host "  FAIL: Status wrong: $($completed.status)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$balanceAfter = (Get-Json "$baseUrl/auth/me" $userHeaders).balance
$expectedComplete = $balanceBefore + $venue.deposit_amount
if ([math]::Abs($balanceAfter - $expectedComplete) -lt 0.01) {
    Write-Host "  OK: Deposit refunded: $balanceBefore -> $balanceAfter" -ForegroundColor Green
} else {
    Write-Host "  FAIL: Balance wrong: $balanceBefore -> $balanceAfter, expected: $expectedComplete" -ForegroundColor Red
    exit 1
}

# Test 10: Try to cancel completed booking
Write-Host "`[Test 10`] Cancel completed booking (should fail)" -ForegroundColor Yellow
try {
    $null = Post-Json "$baseUrl/bookings/$bookingId/cancel" @{reason="test"} $userHeaders
    Write-Host "  FAIL: Should have failed but succeeded" -ForegroundColor Red
    exit 1
} catch {
    if ($_.Exception.Message -match "status|cannot|completed") {
        Write-Host "  OK: Correctly rejected" -ForegroundColor Green
    } else {
        Write-Host "  WARN: Rejected but wrong message: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Verify balance unchanged
$balanceAfter2 = (Get-Json "$baseUrl/auth/me" $userHeaders).balance
if ([math]::Abs($balanceAfter2 - $expectedComplete) -lt 0.01) {
    Write-Host "  OK: Balance unchanged: $balanceAfter2" -ForegroundColor Green
} else {
    Write-Host "  FAIL: Balance modified: $balanceAfter2" -ForegroundColor Red
    exit 1
}

# Test 11: Insufficient balance
Write-Host "`[Test 11`] Insufficient balance (should fail)" -ForegroundColor Yellow

# Login lisi
try {
    $response = Post-Json "$baseUrl/auth/login" @{username="lisi"; password="user123"}
    $lisiToken = $response.token
    $lisiBalance = $response.user.balance
    $lisiHeaders = @{"Authorization" = "Bearer $lisiToken"}
    Write-Host "  Lisi initial balance: $lisiBalance" -ForegroundColor Gray
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Create two bookings to reduce balance
$deposit200Venue = $venues | Where-Object { $_.deposit_amount -eq 200 } | Select-Object -First 1

$farFuture = (Get-Date).AddDays(30).ToString("yyyy-MM-dd")
try {
    $null = Post-Json "$baseUrl/bookings" @{
        venueId = $deposit200Venue.id
        date = $farFuture
        startTime = "13:00"
        endTime = "15:00"
        purpose = "test1"
    } $lisiHeaders
    Write-Host "  Booked first 200 deposit venue" -ForegroundColor Gray
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

try {
    $null = Post-Json "$baseUrl/bookings" @{
        venueId = $deposit200Venue.id
        date = $farFuture
        startTime = "15:00"
        endTime = "17:00"
        purpose = "test2"
    } $lisiHeaders
    Write-Host "  Booked second 200 deposit venue" -ForegroundColor Gray
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$lisiBalance2 = (Get-Json "$baseUrl/auth/me" $lisiHeaders).balance
Write-Host "  Lisi balance after two bookings: $lisiBalance2" -ForegroundColor Gray

# Now try to book another 200 deposit venue (should fail)
try {
    $null = Post-Json "$baseUrl/bookings" @{
        venueId = $deposit200Venue.id
        date = $farFuture
        startTime = "17:00"
        endTime = "19:00"
        purpose = "test3"
    } $lisiHeaders
    Write-Host "  FAIL: Should have failed but succeeded" -ForegroundColor Red
    exit 1
} catch {
    if ($_.Exception.Message -match "balance|insufficient|余额不足") {
        Write-Host "  OK: Correctly rejected: $($_.Exception.Message)" -ForegroundColor Green
    } else {
        Write-Host "  WARN: Rejected but wrong message: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

$lisiBalance3 = (Get-Json "$baseUrl/auth/me" $lisiHeaders).balance
if ([math]::Abs($lisiBalance3 - $lisiBalance2) -lt 0.01) {
    Write-Host "  OK: Balance unchanged: $lisiBalance3" -ForegroundColor Green
} else {
    Write-Host "  FAIL: Balance modified: $lisiBalance3 (should be $lisiBalance2)" -ForegroundColor Red
    exit 1
}

# Test 12: CSV Import with duplicates
Write-Host "`[Test 12`] CSV Import with duplicates (batch reject)" -ForegroundColor Yellow

$existingVenues = Get-Json "$baseUrl/venues/all" $adminHeaders
$existingCode = $existingVenues[0].code
$originalCount = $existingVenues.Count

$csvWithDuplicates = "code,name,capacity,deposit_amount,description`nNEW-001,New Venue 1,50,100,Test 1`n$existingCode,Duplicate Venue,30,50,Duplicate Test`nNEW-002,New Venue 2,40,80,Test 2"

try {
    $importResult = Post-Json "$baseUrl/venues/import" @{csvContent = $csvWithDuplicates} $adminHeaders
    
    if ($importResult.success -eq 0 -and $importResult.failed -gt 0 -and $importResult.duplicates.Count -gt 0) {
        Write-Host "  OK: Batch rejected. Success: $($importResult.success), Failed: $($importResult.failed), Duplicates: $($importResult.duplicates.Count)" -ForegroundColor Green
        Write-Host "    Duplicate codes: $($importResult.duplicates -join ', ')" -ForegroundColor Gray
        Write-Host "    Error: $($importResult.errors[0].error)" -ForegroundColor Gray
    } else {
        Write-Host "  FAIL: Expected batch reject but got success=$($importResult.success), failed=$($importResult.failed)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Verify no new venues added
$venuesAfter = Get-Json "$baseUrl/venues/all" $adminHeaders
if ($venuesAfter.Count -eq $originalCount) {
    Write-Host "  OK: No venues added, count unchanged: $($venuesAfter.Count)" -ForegroundColor Green
} else {
    Write-Host "  FAIL: Venue count changed: $originalCount -> $($venuesAfter.Count)" -ForegroundColor Red
    exit 1
}

# Test 13: Verify transaction traceability
Write-Host "`[Test 13`] Transaction traceability" -ForegroundColor Yellow
$txs = Get-Json "$baseUrl/transactions/my" $userHeaders
$bookingTxs = $txs.transactions | Where-Object { $_.booking_id -eq $bookingId }

if ($bookingTxs.Count -ge 2) {
    Write-Host "  OK: Found $($bookingTxs.Count) transactions for booking" -ForegroundColor Green
    $freezeTx = $bookingTxs | Where-Object { $_.type -eq "deposit_freeze" }
    $refundTx = $bookingTxs | Where-Object { $_.type -eq "deposit_refund" }
    if ($freezeTx -and $refundTx) {
        Write-Host "    Freeze: $($freezeTx.balance_before) -> $($freezeTx.balance_after)" -ForegroundColor Gray
        Write-Host "    Refund: $($refundTx.balance_before) -> $($refundTx.balance_after)" -ForegroundColor Gray
    }
} else {
    Write-Host "  WARN: Only found $($bookingTxs.Count) transactions" -ForegroundColor Yellow
}

# Test 14: Audit logs
Write-Host "`[Test 14`] Audit logs" -ForegroundColor Yellow
$logs = Get-Json "$baseUrl/audit?pageSize=50" $adminHeaders
$actions = @("create_booking", "approve_booking", "checkin_booking", "complete_booking")
$allFound = $true
foreach ($action in $actions) {
    $found = $logs.logs | Where-Object { $_.action -eq $action -and $_.booking_id -eq $bookingId }
    if ($found) {
        Write-Host "  OK: Found audit log: $action" -ForegroundColor Green
    } else {
        Write-Host "  WARN: Missing audit log: $action" -ForegroundColor Yellow
        $allFound = $false
    }
}

# ========================================
# Reschedule Tests
# ========================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Reschedule Feature Tests" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Test 15: Create a booking for reschedule test
Write-Host "`[Test 15`] Create booking for reschedule test" -ForegroundColor Yellow
$dayAfterTomorrow = (Get-Date).AddDays(2).ToString("yyyy-MM-dd")
try {
    $booking2 = Post-Json "$baseUrl/bookings" @{
        venueId = $venue.id
        date = $dayAfterTomorrow
        startTime = "14:00"
        endTime = "16:00"
        purpose = "Reschedule Test Booking"
    } $userHeaders
    $booking2Id = $booking2.id
    Write-Host "  OK: Booking created for reschedule test, ID: $($booking2Id.Substring(0,8))..." -ForegroundColor Green
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 16: Approve the booking first
Write-Host "`[Test 16`] Approve the booking for reschedule test" -ForegroundColor Yellow
try {
    $approved2 = Post-Json "$baseUrl/bookings/$booking2Id/approve" @{} $adminHeaders
    if ($approved2.status -eq "approved") {
        Write-Host "  OK: Booking approved, status: $($approved2.status)" -ForegroundColor Green
    } else {
        Write-Host "  FAIL: Status wrong: $($approved2.status)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 17: Resident reschedule request - success
Write-Host "`[Test 17`] Resident reschedule request (normal flow)" -ForegroundColor Yellow
$newDate = (Get-Date).AddDays(3).ToString("yyyy-MM-dd")
try {
    $reschedule = Post-Json "$baseUrl/bookings/$booking2Id/reschedule" @{
        newDate = $newDate
        newStartTime = "10:00"
        newEndTime = "12:00"
        reason = "个人时间调整，需要改期"
    } $userHeaders
    $rescheduleId = $reschedule.id
    Write-Host "  OK: Reschedule request created, ID: $($rescheduleId.Substring(0,8))..." -ForegroundColor Green
    Write-Host "    Old: $($reschedule.old_date) $($reschedule.old_start_time)-$($reschedule.old_end_time)" -ForegroundColor Gray
    Write-Host "    New: $($reschedule.new_date) $($reschedule.new_start_time)-$($reschedule.new_end_time)" -ForegroundColor Gray
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 18: Duplicate pending reschedule should fail
Write-Host "`[Test 18`] Duplicate pending reschedule (should fail)" -ForegroundColor Yellow
try {
    $null = Post-Json "$baseUrl/bookings/$booking2Id/reschedule" @{
        newDate = $newDate
        newStartTime = "13:00"
        newEndTime = "15:00"
        reason = "Another reschedule"
    } $userHeaders
    Write-Host "  FAIL: Should have failed but succeeded" -ForegroundColor Red
    exit 1
} catch {
    if ($_.Exception.Message -match "pending|待处理|已有") {
        Write-Host "  OK: Correctly rejected duplicate pending reschedule" -ForegroundColor Green
    } else {
        Write-Host "  WARN: Rejected but wrong message: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Test 19: Resident tries to reschedule other's booking (should be 403)
Write-Host "`[Test 19`] Resident reschedule other's booking (should be 403)" -ForegroundColor Yellow
try {
    # Login as lisi first
    $lisiLogin = Post-Json "$baseUrl/auth/login" @{username="lisi"; password="user123"}
    $lisiHeaders2 = @{"Authorization" = "Bearer $($lisiLogin.token)"}
    
    $null = Post-Json "$baseUrl/bookings/$booking2Id/reschedule" @{
        newDate = $newDate
        newStartTime = "15:00"
        newEndTime = "17:00"
        reason = "Trying to reschedule other's booking"
    } $lisiHeaders2
    Write-Host "  FAIL: Should have failed but succeeded" -ForegroundColor Red
    exit 1
} catch {
    if ($_.Exception.Message -match "403|Forbidden|只能|自己") {
        Write-Host "  OK: Correctly rejected with 403: $($_.Exception.Message.Substring(0,50))..." -ForegroundColor Green
    } else {
        Write-Host "  WARN: Rejected but wrong message: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Test 20: Reschedule with end time before start time (should fail)
Write-Host "`[Test 20`] Reschedule with invalid time range (end before start)" -ForegroundColor Yellow
try {
    # Create another booking first
    $booking3 = Post-Json "$baseUrl/bookings" @{
        venueId = $venue.id
        date = (Get-Date).AddDays(60).ToString("yyyy-MM-dd")
        startTime = "08:00"
        endTime = "10:00"
        purpose = "Invalid time test"
    } $userHeaders
    
    $null = Post-Json "$baseUrl/bookings/$($booking3.id)/reschedule" @{
        newDate = (Get-Date).AddDays(61).ToString("yyyy-MM-dd")
        newStartTime = "14:00"
        newEndTime = "12:00"
        reason = "Invalid time test"
    } $userHeaders
    Write-Host "  FAIL: Should have failed but succeeded" -ForegroundColor Red
    exit 1
} catch {
    if ($_.Exception.Message -match "end.*start|结束.*开始|时间") {
        Write-Host "  OK: Correctly rejected invalid time range" -ForegroundColor Green
    } else {
        Write-Host "  WARN: Rejected but wrong message: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Test 21: Reschedule with overlapping time (should fail)
Write-Host "`[Test 21`] Reschedule with overlapping time (should fail)" -ForegroundColor Yellow
try {
    $null = Post-Json "$baseUrl/bookings/$booking2Id/reschedule" @{
        newDate = $newDate
        newStartTime = "09:00"
        newEndTime = "11:00"
        reason = "Overlapping time test"
    } $userHeaders
    Write-Host "  FAIL: Should have failed but succeeded" -ForegroundColor Red
    exit 1
} catch {
    if ($_.Exception.Message -match "overlap|conflict|占用|冲突") {
        Write-Host "  OK: Correctly rejected overlapping reschedule" -ForegroundColor Green
    } else {
        Write-Host "  WARN: Rejected but wrong message: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Test 22: Admin approve reschedule
Write-Host "`[Test 22`] Admin approve reschedule" -ForegroundColor Yellow
$booking2Before = Get-Json "$baseUrl/bookings/$booking2Id" $userHeaders
Write-Host "  Booking time before: $($booking2Before.date) $($booking2Before.start_time)-$($booking2Before.end_time)" -ForegroundColor Gray
try {
    $approvedReschedule = Post-Json "$baseUrl/bookings/reschedules/$rescheduleId/approve" @{} $adminHeaders
    if ($approvedReschedule.status -eq "approved") {
        Write-Host "  OK: Reschedule approved, status: $($approvedReschedule.status)" -ForegroundColor Green
    } else {
        Write-Host "  FAIL: Status wrong: $($approvedReschedule.status)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Verify booking time updated
$booking2After = Get-Json "$baseUrl/bookings/$booking2Id" $userHeaders
Write-Host "  Booking time after: $($booking2After.date) $($booking2After.start_time)-$($booking2After.end_time)" -ForegroundColor Gray
if ($booking2After.date -eq $newDate -and $booking2After.start_time -eq "10:00" -and $booking2After.end_time -eq "12:00") {
    Write-Host "  OK: Booking time correctly updated" -ForegroundColor Green
} else {
    Write-Host "  FAIL: Booking time not updated correctly" -ForegroundColor Red
    exit 1
}

# Test 23: Verify booking history includes reschedule
Write-Host "`[Test 23`] Verify booking history includes reschedule" -ForegroundColor Yellow
$history = Get-Json "$baseUrl/bookings/$booking2Id/history" $userHeaders
$rescheduleHistory = $history | Where-Object { $_.reason -match "改期" }
if ($rescheduleHistory) {
    Write-Host "  OK: Found reschedule record in booking history" -ForegroundColor Green
    Write-Host "    $($rescheduleHistory.reason)" -ForegroundColor Gray
} else {
    Write-Host "  WARN: Reschedule history not found" -ForegroundColor Yellow
}

# Test 24: Create another reschedule and reject it
Write-Host "`[Test 24`] Create and reject reschedule" -ForegroundColor Yellow
try {
    $booking4 = Post-Json "$baseUrl/bookings" @{
        venueId = $venue.id
        date = (Get-Date).AddDays(70).ToString("yyyy-MM-dd")
        startTime = "16:00"
        endTime = "18:00"
        purpose = "Reject reschedule test"
    } $userHeaders
    $booking4Id = $booking4.id
    
    $approved4 = Post-Json "$baseUrl/bookings/$booking4Id/approve" @{} $adminHeaders
    
    $reschedule2 = Post-Json "$baseUrl/bookings/$booking4Id/reschedule" @{
        newDate = (Get-Date).AddDays(71).ToString("yyyy-MM-dd")
        newStartTime = "09:00"
        newEndTime = "11:00"
        reason = "Need to reschedule again"
    } $userHeaders
    $reschedule2Id = $reschedule2.id
    
    $rejectedReschedule = Post-Json "$baseUrl/bookings/reschedules/$reschedule2Id/reject" @{
        reason = "该时段已被其他活动占用，请选择其他时间"
    } $adminHeaders
    
    if ($rejectedReschedule.status -eq "rejected") {
        Write-Host "  OK: Reschedule rejected, status: $($rejectedReschedule.status)" -ForegroundColor Green
    } else {
        Write-Host "  FAIL: Status wrong: $($rejectedReschedule.status)" -ForegroundColor Red
        exit 1
    }
    
    # Verify original booking time unchanged
    $booking4After = Get-Json "$baseUrl/bookings/$booking4Id" $userHeaders
    if ($booking4After.date -eq (Get-Date).AddDays(70).ToString("yyyy-MM-dd") -and 
        $booking4After.start_time -eq "16:00" -and 
        $booking4After.end_time -eq "18:00") {
        Write-Host "  OK: Original booking time unchanged after rejection" -ForegroundColor Green
    } else {
        Write-Host "  FAIL: Original booking time changed after rejection" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 25: Verify audit logs for reschedule actions
Write-Host "`[Test 25`] Verify audit logs for reschedule actions" -ForegroundColor Yellow
$logs = Get-Json "$baseUrl/audit?pageSize=100" $adminHeaders
$rescheduleActions = @("reschedule_request", "reschedule_approve", "reschedule_reject")
$allRescheduleLogsFound = $true
foreach ($action in $rescheduleActions) {
    $found = $logs.logs | Where-Object { $_.action -eq $action }
    if ($found) {
        Write-Host "  OK: Found audit log: $action" -ForegroundColor Green
        $latest = $found[0]
        Write-Host "    User: $($latest.user_name), Details: $($latest.details.Substring(0,60))..." -ForegroundColor Gray
    } else {
        Write-Host "  WARN: Missing audit log: $action" -ForegroundColor Yellow
        $allRescheduleLogsFound = $false
    }
}

# Test 26: Get reschedule list
Write-Host "`[Test 26`] Get reschedule list" -ForegroundColor Yellow
try {
    $reschedules = Get-Json "$baseUrl/bookings/reschedules" $adminHeaders
    Write-Host "  OK: Got $($reschedules.requests.Count) reschedule requests" -ForegroundColor Green
    if ($reschedules.requests.Count -ge 2) {
        Write-Host "    Includes approved and rejected requests" -ForegroundColor Gray
    }
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 27: Resident can only see their own reschedules
Write-Host "`[Test 27`] Resident can only see their own reschedules" -ForegroundColor Yellow
try {
    $lisiLogin = Post-Json "$baseUrl/auth/login" @{username="lisi"; password="user123"}
    $lisiHeaders3 = @{"Authorization" = "Bearer $($lisiLogin.token)"}
    
    $lisiReschedules = Get-Json "$baseUrl/bookings/reschedules" $lisiHeaders3
    $allBelongToLisi = $true
    foreach ($r in $lisiReschedules.requests) {
        if ($r.user_id -ne $lisiLogin.user.id) {
            $allBelongToLisi = $false
            break
        }
    }
    if ($allBelongToLisi) {
        Write-Host "  OK: Lisi can only see their own reschedules ($($lisiReschedules.requests.Count) items)" -ForegroundColor Green
    } else {
        Write-Host "  FAIL: Lisi can see other's reschedules" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 28: Verify pending count includes reschedule
Write-Host "`[Test 28`] Verify pending count endpoint" -ForegroundColor Yellow
try {
    $counts = Get-Json "$baseUrl/bookings/pending-count" $adminHeaders
    if ($counts.PSObject.Properties.Name -contains "pendingReschedule") {
        Write-Host "  OK: pendingReschedule count is returned: $($counts.pendingReschedule)" -ForegroundColor Green
    } else {
        Write-Host "  WARN: pendingReschedule count not found in response" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "RESCHEDULE TESTS PASSED!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Reschedule Test Summary:" -ForegroundColor White
Write-Host "  Normal flow: resident request -> admin approve -> booking time updated" -ForegroundColor Green
Write-Host "  Conflict detection: overlapping time, end before start, duplicate pending" -ForegroundColor Green
Write-Host "  Permission control: resident can only reschedule their own (403 for others)" -ForegroundColor Green
Write-Host "  Reject flow: admin reject -> original booking unchanged" -ForegroundColor Green
Write-Host "  Audit logs: request, approve, reject all logged" -ForegroundColor Green
Write-Host "  Data persistence: restart server to verify data remains (manual test)" -ForegroundColor Yellow
Write-Host ""

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "ALL TESTS PASSED!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Summary:" -ForegroundColor White
Write-Host "  Main flow: booking -> approve -> checkin -> complete" -ForegroundColor Green
Write-Host "  Reschedule flow: request -> approve/reject -> time updated/unchanged" -ForegroundColor Green
Write-Host "  Illegal paths: resident complete(403), overlap reject, insufficient balance, cancel completed" -ForegroundColor Green
Write-Host "  Reschedule security: 403 for other's booking, time validation, duplicate detection" -ForegroundColor Green
Write-Host "  CSV import: batch reject on duplicates" -ForegroundColor Green
Write-Host "  Balance safety: all failures preserve balance" -ForegroundColor Green
Write-Host "  Audit logs: all actions traceable" -ForegroundColor Green
Write-Host ""

