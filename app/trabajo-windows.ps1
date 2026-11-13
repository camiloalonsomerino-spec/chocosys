# Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
# Mete un proceso en un trabajo de Windows con «matar al cerrar» y le deja a él la única copia del trabajo.
# Cuando ese proceso muere (cierre normal o caída), Windows cierra todo lo que abrió después: ningún claude.exe queda suelto.
# Idea de Orca (MIT, stablyai/orca, src/main/windows/windows-pty-job.ts), hecha sin módulo nativo.
param([Parameter(Mandatory)][int]$Proceso)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class Trabajo {
  [StructLayout(LayoutKind.Sequential)] struct Basico { public long a, b; public uint Banderas; public UIntPtr c, d; public uint e; public UIntPtr f; public uint g, h; }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct Extendido { public Basico B; public Io I; public UIntPtr x, y, z, w; }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr j, int c, ref Extendido i, uint l);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint a, bool h, int pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool DuplicateHandle(IntPtr sp, IntPtr h, IntPtr tp, out IntPtr th, uint a, bool i, uint o);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  public static void Asignar(int pid) {
    IntPtr j = CreateJobObject(IntPtr.Zero, null);
    if (j == IntPtr.Zero) throw new Exception("CreateJobObject " + Marshal.GetLastWin32Error());
    var info = new Extendido();
    info.B.Banderas = 0x2000 | 0x800; // matar al cerrar | se permite salir del trabajo a quien lo pida
    if (!SetInformationJobObject(j, 9, ref info, (uint)Marshal.SizeOf(info))) throw new Exception("SetInformationJobObject " + Marshal.GetLastWin32Error());
    IntPtr p = OpenProcess(0x0100 | 0x0001 | 0x0040, false, pid); // cuota | terminar | duplicar
    if (p == IntPtr.Zero) throw new Exception("OpenProcess " + Marshal.GetLastWin32Error());
    if (!AssignProcessToJobObject(j, p)) throw new Exception("AssignProcessToJobObject " + Marshal.GetLastWin32Error());
    IntPtr copia;
    if (!DuplicateHandle(GetCurrentProcess(), j, p, out copia, 0, false, 2)) throw new Exception("DuplicateHandle " + Marshal.GetLastWin32Error());
  }
}
'@
[Trabajo]::Asignar($Proceso)
'ok'
