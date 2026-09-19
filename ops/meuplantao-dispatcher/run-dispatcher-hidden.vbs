Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
cmdPath = scriptDir & "\run-dispatcher.cmd"
args = ""
For i = 0 To WScript.Arguments.Count - 1
    args = args & " """ & WScript.Arguments(i) & """"
Next
Set wshShell = CreateObject("WScript.Shell")
returnCode = wshShell.Run("""" & cmdPath & """" & args, 0, True)
WScript.Quit returnCode
