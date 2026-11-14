# 系统音频检测探针（方案 A 的可行性验证）。
#
# 目标：确认 Windows 上能否读到"当前有没有音频在播放"。这是 M4 宿主侧
# 音符触发源的落地方式（WASAPI 峰值轮询，与 MDP native/src/music.rs 同思路）。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\audio-probe.ps1 -Seconds 10
#   pwsh -File tools/audio-probe.ps1 -Seconds 10
# 边放音乐边跑；peak 持续 > 0.001 就说明能检测到后台音频。
param([int]$Seconds = 10)

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
            // dataFlow: eRender = 0；role: eConsole = 0
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

if (-not [AudioProbe]::Init()) {
    Write-Error 'WASAPI 初始化失败（没有默认输出设备，或接口不兼容）'
    exit 1
}

$deadline = (Get-Date).AddSeconds($Seconds)
$max = 0.0
$hits = 0
$samples = 0
while ((Get-Date) -lt $deadline) {
    $peak = [AudioProbe]::Peak()
    $samples++
    if ($peak -gt $max) { $max = $peak }
    if ($peak -gt 0.001) { $hits++ }
    $bar = '#' * [int]([Math]::Min(40, $peak * 40))
    "{0:HH:mm:ss}  peak={1:N4}  {2}" -f (Get-Date), $peak, $bar
    Start-Sleep -Milliseconds 750
}

"---"
"max peak over ${Seconds}s = {0:N4}   samples=$samples  hits=$hits" -f $max
if ($hits -gt 0) {
    '结论：能检测到音频播放（peak 大于阈值）'
} elseif ($max -gt 0) {
    '结论：能读到非零峰值，但没超过阈值（可能是静音或极低音量）'
} else {
    '结论：全程峰值为 0——播放音乐后重试；若仍为 0，说明该声卡不支持设备级峰值，需改会话级（IAudioSessionManager2）'
}
exit 0
