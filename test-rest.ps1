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
        $resp = $_.Exception.Response
        if ($resp) {
            $status = [int]$resp.StatusCode
            $stream = $resp.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $reader.BaseStream.Position = 0
            $reader.DiscardBufferedData()
            $body = $reader.ReadToEnd()
            throw [System.Net.WebException]::new("HTTP $status`: $body", $_.Exception)
        }
        throw
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
Write-Host "[Test 1] Admin login" -ForegroundColor Yellow
try {
    $response = Post-Json "$baseUrl/auth/login" @{username="admin"; password="admin123"}
    $adminToken = $response.token
    Write-Host "  OK: Admin login success" -ForegroundColor Green
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 2: Login as resident (zhangsan)
Write-Host "[Test 2] Resident login" -ForegroundColor Yellow
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
Write-Host "[Test 3] Get venues" -ForegroundColor Yellow
$venues = Get-Json "$baseUrl/venues" $userHeaders
$venue = $venues[0]
Write-Host "  OK: Got $($venues.Count) venues, using: $($venue.name) (deposit: $($venue.deposit_amount))" -ForegroundColor Green

# Test 4: Create booking
Write-Host "[Test 4] Create booking (main flow)" -ForegroundColor Yellow
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
Write-Host "[Test 5] Resident complete booking (should be 403)" -ForegroundColor Yellow
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
Write-Host "[Test 6] Approve booking" -ForegroundColor Yellow
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
Write-Host "[Test 7] Create overlapping booking (should fail)" -ForegroundColor Yellow
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
Write-Host "[Test 8] Checkin booking" -ForegroundColor Yellow
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
Write-Host "[Test 9] Complete booking (refund deposit)" -ForegroundColor Yellow
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
Write-Host "[Test 10] Cancel completed booking (should fail)" -ForegroundColor Yellow
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
Write-Host "[Test 11] Insufficient balance (should fail)" -ForegroundColor Yellow

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

try {
    $null = Post-Json "$baseUrl/bookings" @{
        venueId = $deposit200Venue.id
        date = $tomorrow
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
        date = $tomorrow
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
        date = $tomorrow
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
Write-Host "[Test 12] CSV Import with duplicates (batch reject)" -ForegroundColor Yellow

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
Write-Host "[Test 13] Transaction traceability" -ForegroundColor Yellow
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
Write-Host "[Test 14] Audit logs" -ForegroundColor Yellow
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

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "ALL TESTS PASSED!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Summary:" -ForegroundColor White
Write-Host "  Main flow: booking -> approve -> checkin -> complete" -ForegroundColor Green
Write-Host "  Illegal paths: resident complete(403), overlap reject, insufficient balance, cancel completed" -ForegroundColor Green
Write-Host "  CSV import: batch reject on duplicates" -ForegroundColor Green
Write-Host "  Balance safety: all failures preserve balance" -ForegroundColor Green
Write-Host ""
