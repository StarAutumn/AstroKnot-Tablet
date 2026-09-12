$bytes = [System.IO.File]::ReadAllBytes('D:\AstroKnot-Tablet\scripts\tests\lv.bin')
$sb = New-Object System.Text.StringBuilder
$cur = New-Object System.Text.StringBuilder
foreach ($b in $bytes) {
  if ($b -ge 32 -and $b -le 126) { [void]$cur.Append([char]$b) }
  else {
    if ($cur.Length -ge 6) { [void]$sb.Append($cur.ToString()); [void]$sb.Append("`n") }
    [void]$cur.Clear()
  }
}
if ($cur.Length -ge 6) { [void]$sb.Append($cur.ToString()); [void]$sb.Append("`n") }
$strs = $sb.ToString()
[System.IO.File]::WriteAllText('D:\AstroKnot-Tablet\scripts\tests\lv-strings.txt', $strs)
$lines = $strs -split "`n"
Write-Host ("total strings: " + $lines.Count)
$astro = $lines | Where-Object { $_ -match 'astroknot|guide|first_run' } | Select-Object -First 40
$astro | ForEach-Object { Write-Host $_ }
