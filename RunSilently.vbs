' ─── Silent Launcher for Pharmacy POS ───────────────────────────────────
' Yeh script PharmacyPOS.exe ko BACKGROUND mein chalata hai, bina kisi
' black CMD window ke. Isi ko "Startup" folder mein shortcut bana ke
' rakhte hain, taake Windows login hone par yeh khud-bakhud chal jaye.

Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")

' Apna khud ka folder reliably nikalo (Startup shortcut se chalne par bhi sahi kaam karega)
strScriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

exePath = strScriptDir & "\PharmacyPOS.exe"

If fso.FileExists(exePath) Then
  WshShell.CurrentDirectory = strScriptDir
  WshShell.Run Chr(34) & exePath & Chr(34), 0, False
Else
  MsgBox "PharmacyPOS.exe nahi mila is folder mein:" & vbCrLf & strScriptDir, vbExclamation, "Pharmacy POS"
End If
