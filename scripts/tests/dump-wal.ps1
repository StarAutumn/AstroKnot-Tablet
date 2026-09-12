$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'adb'
$psi.Arguments = 'exec-out run-as com.astroknot.tablet sh /data/local/tmp/trace.sh'
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$p = [System.Diagnostics.Process]::Start($psi)
$ms = New-Object System.IO.MemoryStream
$p.StandardOutput.BaseStream.CopyTo($ms)
$err = $p.StandardError.ReadToEnd()
$p.WaitForExit()
$bytes = $ms.ToArray()
[System.IO.File]::WriteAllBytes('D:\AstroKnot-Tablet\scripts\tests\lv.bin', $bytes)
Write-Host ("BYTES: " + $bytes.Length + " EXIT: " + $p.ExitCode)
if ($err) { Write-Host ("ERR: " + $err) }
$t = [System.Text.Encoding]::ASCII.GetString($bytes)
foreach ($k in @('astroknot_guide_done','astroknot_guide_completed','astroknot_guide_current_step','astroknot_guide_step2','astroknot_first_run','astroknot_test_key','astroknot_web_projects_current','https://localhost')) {
  Write-Host ($k + " : " + $t.Contains($k))
}
