from types import SimpleNamespace

from api.routers import system


def test_windows_gpu_fallback_prefers_discrete_adapter(monkeypatch):
    monkeypatch.setattr(system.sys, "platform", "win32")
    monkeypatch.setattr(system.shutil, "which", lambda name: "powershell.exe")
    monkeypatch.setattr(
        system.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            stdout="Microsoft Basic Display Adapter\nIntel UHD Graphics 770\nAMD Radeon RX 7900 XTX\n"
        ),
    )

    assert system._detect_os_gpu_name() == "AMD Radeon RX 7900 XTX"


def test_linux_gpu_fallback_reads_lspci_machine_output(monkeypatch):
    monkeypatch.setattr(system.sys, "platform", "linux")
    monkeypatch.setattr(system.shutil, "which", lambda name: "/usr/bin/lspci")
    monkeypatch.setattr(
        system.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            stdout=(
                '00:02.0 "VGA compatible controller" "Intel Corporation" "UHD Graphics"\n'
                '03:00.0 "3D controller" "NVIDIA Corporation" "GeForce RTX 4090"\n'
            )
        ),
    )

    assert system._detect_os_gpu_name() == "NVIDIA Corporation GeForce RTX 4090"
