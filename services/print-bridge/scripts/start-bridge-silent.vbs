Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptsDir = fso.GetParentFolderName(WScript.ScriptFullName)
bridgeRoot = fso.GetParentFolderName(scriptsDir)
supervisorJs = fso.BuildPath(scriptsDir, "bridge-supervisor.mjs")

shell.CurrentDirectory = bridgeRoot
shell.Run "node.exe """ & supervisorJs & """", 0, False
