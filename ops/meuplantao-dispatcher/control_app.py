from __future__ import annotations

import queue
import subprocess
import sys
import threading
from pathlib import Path

try:
    import tkinter as tk
    from tkinter import messagebox, scrolledtext
except Exception:
    tk = None

import control_service

def _log_path() -> Path:
    try:
        import dispatcher_home
        return dispatcher_home.log_path()
    except Exception:
        return Path(__file__).resolve().parent / "dispatcher.log"

class ControlApp:
    def __init__(self, root=None, service=None):
        self.service = service or control_service
        self.root = root
        self._run_once_busy = False
        self._run_queue: queue.Queue = queue.Queue()
        self.run_button = None
        if root is not None and tk is not None:
            self._build(root)

    def _build(self, root) -> None:
        root.title("Maick Dispatcher Control")
        self.state_label = tk.Label(root, text="...", font=("Segoe UI", 16, "bold"))
        self.state_label.pack(padx=16, pady=8)
        self.info_label = tk.Label(root, text="", justify="left", font=("Segoe UI", 9))
        self.info_label.pack(padx=16, pady=4)
        self.message_label = tk.Label(root, text="", wraplength=420, justify="left", font=("Segoe UI", 9))
        self.message_label.pack(padx=16, pady=4)
        row = tk.Frame(root)
        row.pack(padx=16, pady=8)
        tk.Button(row, text="ATIVAR", command=self.on_resume).pack(side="left", padx=4)
        tk.Button(row, text="PAUSAR", command=self.on_pause).pack(side="left", padx=4)
        self.run_button = tk.Button(row, text="EXECUTAR AGORA", command=self.on_run_once)
        self.run_button.pack(side="left", padx=4)
        tk.Button(row, text="ABRIR LOGS", command=self.open_logs).pack(side="left", padx=4)
        tk.Button(row, text="ATUALIZAR", command=self.refresh).pack(side="left", padx=4)
        self.log_box = scrolledtext.ScrolledText(root, height=10, width=64, state="disabled")
        self.log_box.pack(padx=16, pady=8)
        self.refresh()

    def _current_status(self) -> dict:
        return self.service.get_status()

    def refresh(self) -> dict:
        status = self._current_status()
        visual = str(status.get("visual", "ERRO"))
        mode = str(status.get("mode", ""))
        runtime = status.get("runtime", {}) or {}
        sched = status.get("scheduler", {}) or {}
        try:
            self.state_label.text = visual
        except Exception:
            pass
        if hasattr(self, "state_label") and hasattr(self.state_label, "config"):
            try:
                self.state_label.config(text=visual)
            except Exception:
                pass
        detail = f"modo={mode} scheduler={sched.get('status', '')} next={status.get('nextRun', '')} last={runtime.get('lastResult', '')}"
        if hasattr(self, "info_label") and hasattr(self.info_label, "config"):
            try:
                self.info_label.config(text=detail)
            except Exception:
                pass
        msg = str(status.get("message", "") or status.get("error", ""))
        if hasattr(self, "message_label") and hasattr(self.message_label, "config"):
            try:
                self.message_label.config(text=msg)
            except Exception:
                pass
        else:
            try:
                self.message_label.text = msg
            except Exception:
                pass
        self._render_logs()
        return status

    def _render_logs(self) -> None:
        try:
            lines = self.service.last_logs(n=30)
        except Exception:
            lines = []
        if hasattr(self, "log_box") and tk is not None:
            try:
                self.log_box.config(state="normal")
                self.log_box.delete("1.0", "end")
                self.log_box.insert("end", "\n".join(lines[-30:]))
                self.log_box.config(state="disabled")
            except Exception:
                pass

    def on_pause(self) -> None:
        try:
            msg = self.service.pause()
        except Exception as exc:
            msg = f"ERRO: {exc}"
        try:
            if hasattr(self.message_label, "config"):
                self.message_label.config(text=str(msg))
            else:
                self.message_label.text = str(msg)
        except Exception:
            pass
        self.refresh()

    def on_resume(self) -> None:
        try:
            msg = self.service.resume()
        except Exception as exc:
            msg = f"ERRO: {exc}"
        try:
            if hasattr(self.message_label, "config"):
                self.message_label.config(text=str(msg))
            else:
                self.message_label.text = str(msg)
        except Exception:
            pass
        self.refresh()

    def on_run_once(self) -> dict:
        if getattr(self, "_run_once_busy", False):
            return {"ignored": True, "result": "run-once already running"}
        self._run_once_busy = True
        self._set_run_enabled(False)
        threading.Thread(target=self._run_once_worker, daemon=True).start()
        self._schedule_poll()
        return {"started": True}

    def _set_run_enabled(self, enabled: bool) -> None:
        button = getattr(self, "run_button", None)
        if button is None:
            return
        try:
            button.config(state="normal" if enabled else "disabled")
        except Exception:
            try:
                button.state = "normal" if enabled else "disabled"
            except Exception:
                pass

    def _schedule_poll(self) -> None:
        after = getattr(getattr(self, "root", None), "after", None)
        if callable(after):
            try:
                after(100, self._poll_run_once)
            except Exception:
                pass

    def _run_once_worker(self) -> None:
        try:
            result = self.service.run_once()
            msg = str((result or {}).get("result", ""))
            ok = bool((result or {}).get("ok", True))
        except Exception as exc:
            msg, ok = f"ERRO: {exc}", False
        try:
            self._run_queue.put({"ok": ok, "result": msg})
        except Exception:
            pass
        self._schedule_poll()

    def _poll_run_once(self) -> None:
        if not getattr(self, "_run_once_busy", False):
            return
        try:
            done = self._run_queue.get_nowait()
        except queue.Empty:
            self._schedule_poll()
            return
        msg = str(done.get("result", ""))
        self._run_once_busy = False
        self._set_run_enabled(True)
        try:
            self.refresh()
        except Exception:
            pass
        try:
            if hasattr(self.message_label, "config"):
                self.message_label.config(text=msg)
            else:
                self.message_label.text = msg
        except Exception:
            pass

    def open_logs(self) -> None:
        try:
            if sys.platform.startswith("win"):
                subprocess.Popen(["notepad.exe", str(_log_path())])
            else:
                subprocess.Popen(["xdg-open", str(_log_path())])
        except Exception as exc:
            if tk is not None:
                try:
                    messagebox.showerror("Logs", str(exc)[:500])
                except Exception:
                    pass

def main() -> int:
    if tk is None:
        print("tkinter indisponivel neste ambiente", file=sys.stderr)
        return 1
    root = tk.Tk()
    ControlApp(root)
    root.mainloop()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
