# README demo. Run from the repository root:
#   DEMO_ROOT=<empty scratch directory> vhs docs/demo.tape
# Everything runs in a throwaway home with fake repos and a scripted local model (docs/demo/mock-model.ts),
# so the recording shows no real sessions and costs no tokens. Uses PowerShell, so it records on Windows.

Output docs/demo.gif

Set Shell "powershell"
Set FontSize 15
Set Width 1200
Set Height 640
Set Padding 12
Set TypingSpeed 35ms
Set Framerate 20

Hide
Type ". (bun docs/demo/setup.ts $env:DEMO_ROOT)"
Enter
Sleep 2s
Type "cls"
Enter
Sleep 500ms
Show

Type "opencode2"
Sleep 300ms
Enter
Sleep 5s

Type "Start a session in acme-api that adds a /health endpoint"
Sleep 400ms
Enter
# The tool call, the background tab and the reply.
Sleep 4s
# acme-api works, then its report wakes this session.
Sleep 6s

Type "/go"
Sleep 600ms
Enter
Sleep 1500ms
Enter
Sleep 4s

Hide
Ctrl+C
Sleep 1s
Type "opencode2 service stop; Stop-Process -Id (Get-NetTCPConnection -LocalPort 4599 -State Listen).OwningProcess"
Enter
Sleep 2s
