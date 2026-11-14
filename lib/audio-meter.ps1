# 常驻音频表：每 750ms 输出一行 peak=<0..1>，由 lib/index.js 作为子进程拉起。
# 只打印读数；阈值判定与 1.5s 衰减窗都在宿主侧（/dsh-whale/audio.json 路由）。
# 输出严格保持 ASCII：Windows PowerShell 5.1 的 stdout 编码会让中文变成乱码，
# 宿主按行解析，多一个字符就会误判。

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumerator { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator
{
    int NotImpl1();
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice
{
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}

[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioMeterInformation
{
    int GetPeakValue(out float peak);
}

public static class AudioProbe
{
    static IAudioMeterInformation meter;

    public static bool Init()
    {
        try
        {
            var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
            IMMDevice device;
            if (enumerator.GetDefaultAudioEndpoint(0, 0, out device) != 0) return false;
            Guid iid = typeof(IAudioMeterInformation).GUID;
            object o;
            if (device.Activate(ref iid, 0, IntPtr.Zero, out o) != 0) return false;
            meter = (IAudioMeterInformation)o;
            return meter != null;
        }
        catch { return false; }
    }

    public static float Peak()
    {
        try { float p; return meter.GetPeakValue(out p) == 0 ? p : -1f; }
        catch { return -1f; }
    }
}
'@ -Language CSharp

$out = [Console]::Out
if (-not [AudioProbe]::Init()) {
    $out.WriteLine('init-failed')
    exit 1
}
$out.WriteLine('ready')
$inv = [System.Globalization.CultureInfo]::InvariantCulture
while ($true) {
    $peak = [AudioProbe]::Peak()
    if ($peak -lt 0) { $peak = 0 }
    $out.WriteLine('peak=' + $peak.ToString('0.0000', $inv))
    Start-Sleep -Milliseconds 750
}
