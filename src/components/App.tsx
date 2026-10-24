"use client";

import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Egg,
  Eye,
  EyeOff,
  History,
  House,
  LayoutDashboard,
  Leaf,
  LogOut,
  LoaderCircle,
  Menu,
  Package,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Sprout,
  TrendingUp,
  Users,
  Wallet,
  Wheat,
  X,
} from "lucide-react";
import { FarmProvider, useFarm } from "@/lib/store";
import { activePrice, dateLabel, money } from "@/lib/domain";
import Dashboard from "./Dashboard";
import Modules from "./Modules";
import EntryModal from "./EntryModal";
import Reports from "./Reports";
import EmployeeWorkspace from "./EmployeeWorkspace";
import ThemeToggle from "./ThemeToggle";
import InstallApp from "./InstallApp";
import PushNotifications from "./PushNotifications";
import ProfileSettings from "./ProfileSettings";
import Avatar from "./Avatar";
import { useBackLayer, usePageNavigation } from "@/lib/navigation";

const navigation = [
  {
    id: "dashboard",
    label: "Ringkasan",
    icon: LayoutDashboard,
    group: "UTAMA",
  },
  { id: "production", label: "Produksi telur", icon: Egg, group: "" },
  { id: "stock", label: "Stok & pengambilan", icon: Package, group: "" },
  { id: "sales", label: "Penjualan telur", icon: ShoppingBag, group: "" },
  { id: "feed", label: "Pakan ternak", icon: Wheat, group: "PETERNAKAN" },
  { id: "cattle", label: "Kandang sapi", icon: House, group: "", soon: true },
  { id: "prices", label: "Harga telur", icon: Wallet, group: "MANAJEMEN" },
  { id: "employees", label: "Karyawan", icon: Users, group: "", admin: true },
  {
    id: "incentives",
    label: "Insentif",
    icon: TrendingUp,
    group: "",
    soon: true,
  },
  { id: "reports", label: "Laporan", icon: ClipboardList, group: "" },
  { id: "corrections", label: "Koreksi data", icon: Settings2, group: "" },
  {
    id: "activity",
    label: "Log aktivitas",
    icon: History,
    group: "",
    admin: true,
  },
];

function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Egg size={25} />
        <Leaf size={12} className="brand-leaf" />
      </span>
      <span>
        Terna<span className="brand-accent">Ku</span>
        <small>KELOLA TERNAK, TUMBUH BERSAMA</small>
      </span>
    </div>
  );
}

function Login() {
  const { login, mode, registrationStatus, register } = useFarm();
  const [screen, setScreen] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [registration, setRegistration] = useState({
    name: "",
    email: "",
    password: "",
    password_confirmation: "",
    setup_token: "",
  });
  const [status, setStatus] = useState<{
    first_admin_required: boolean;
    setup_enabled: boolean;
  } | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [result, setResult] = useState<{
    status: "active" | "pending";
    message: string;
  } | null>(null);
  async function loadRegistrationStatus() {
    setStatusBusy(true);
    setStatusError("");
    try {
      setStatus(await registrationStatus());
    } catch (err) {
      setStatus(null);
      setStatusError(
        err instanceof Error ? err.message : "Pendaftaran belum dapat dimuat.",
      );
    } finally {
      setStatusBusy(false);
    }
  }
  function openRegistration() {
    setScreen("register");
    setError("");
    setResult(null);
    setShowPassword(false);
    void loadRegistrationStatus();
  }
  function backToLogin() {
    if (result) setEmail(registration.email.trim());
    setPassword("");
    setScreen("login");
    setError("");
    setResult(null);
    setRegistration((value) => ({
      ...value,
      password: "",
      password_confirmation: "",
      setup_token: "",
    }));
  }
  useBackLayer(screen === "register", backToLogin);
  async function signUp(event: React.FormEvent) {
    event.preventDefault();
    if (!status || statusBusy || busy) return;
    setError("");
    if (registration.password !== registration.password_confirmation) {
      setError(
        "Konfirmasi kata sandi belum sama. Periksa kembali kata sandi Anda.",
      );
      return;
    }
    const passwordBytes = new TextEncoder().encode(
      registration.password,
    ).length;
    if (Array.from(registration.password).length < 12) {
      setError("Gunakan kata sandi minimal 12 karakter.");
      return;
    }
    if (passwordBytes > 72) {
      setError("Kata sandi terlalu panjang. Gunakan lebih sedikit karakter.");
      return;
    }
    setBusy(true);
    try {
      const response = await register({
        name: registration.name.trim(),
        email: registration.email.trim(),
        password: registration.password,
        password_confirmation: registration.password_confirmation,
        ...(status.first_admin_required
          ? { setup_token: registration.setup_token.trim() }
          : {}),
      });
      setResult(response);
      setRegistration((value) => ({
        ...value,
        password: "",
        password_confirmation: "",
        setup_token: "",
      }));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Akun belum dapat didaftarkan.",
      );
      // Refresh setup state if another owner completed first-admin setup.
      void loadRegistrationStatus();
    } finally {
      setBusy(false);
    }
  }
  async function signIn(e?: React.FormEvent, demoEmail?: string) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(demoEmail || email, demoEmail ? "Demo123!" : password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tidak dapat masuk.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-story">
        <Brand />
        <div>
          <span className="eyebrow">SAHABAT USAHA PETERNAKAN ANDA</span>
          <h1>
            Catatan peternakan,
            <br />
            lebih mudah.
          </h1>
          <p>
            Catat panen, penjualan, dan pakan dalam satu tempat. Bisa langsung
            dari HP.
          </p>
          <FarmArt />
        </div>
        <small>Peternakan dalam genggaman.</small>
      </section>
      <section className="login-form-wrap">
        <div className="login-theme-control">
          <ThemeToggle />
        </div>
        {screen === "register" ? (
          <div className="login-form registration-form">
            <button
              type="button"
              className="auth-back"
              onClick={backToLogin}
              disabled={busy}
            >
              <ArrowLeft size={16} /> Kembali ke masuk
            </button>
            <span className="icon-box green">
              {result ? <Check /> : <Users />}
            </span>
            {result ? (
              <div className="registration-result" role="status">
                <h2>
                  {result.status === "active"
                    ? "Akun admin siap digunakan"
                    : "Pendaftaran diterima"}
                </h2>
                <p>{result.message}</p>
                {result.status === "pending" && (
                  <div className="auth-notice">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>Menunggu persetujuan admin</strong>
                      <p>
                        Admin peternakan akan memeriksa pendaftaran Anda. Akun
                        baru dapat masuk setelah disetujui. Hubungi admin untuk
                        mengetahui statusnya.
                      </p>
                    </div>
                  </div>
                )}
                <button
                  className="btn btn-primary w-100 mt-4"
                  type="button"
                  onClick={backToLogin}
                >
                  Kembali ke halaman masuk <ArrowRight size={17} />
                </button>
              </div>
            ) : (
              <form onSubmit={signUp}>
                <h2>
                  {status?.first_admin_required
                    ? "Buat admin pertama"
                    : "Daftar akun TernaKu"}
                </h2>
                <p className="auth-description">
                  {status?.first_admin_required
                    ? "Mulai kelola peternakan dengan akun admin Anda."
                    : "Bergabung sebagai karyawan di peternakan ini."}
                </p>
                {statusBusy && (
                  <p className="auth-status" role="status">
                    <LoaderCircle size={16} className="spin" /> Memeriksa
                    pendaftaran…
                  </p>
                )}
                {statusError && (
                  <div className="alert alert-danger mt-3" role="alert">
                    <p className="mb-2">{statusError}</p>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => void loadRegistrationStatus()}
                      disabled={statusBusy}
                    >
                      Coba lagi
                    </button>
                  </div>
                )}
                {status && !statusBusy && (
                  <div className="auth-notice">
                    <ShieldCheck size={19} />
                    <div>
                      <strong>
                        {status.first_admin_required
                          ? "Khusus pemilik peternakan"
                          : "Persetujuan admin diperlukan"}
                      </strong>
                      <p>
                        {status.first_admin_required
                          ? status.setup_enabled
                            ? "Masukkan kode penyiapan dari pengelola hosting untuk membuat admin pertama."
                            : "Kode penyiapan belum diaktifkan. Hubungi pengelola hosting untuk mengaktifkan pendaftaran admin pertama."
                          : "Akun terdaftar sebagai karyawan dan dapat digunakan setelah disetujui oleh admin."}
                      </p>
                    </div>
                  </div>
                )}
                <label className="form-label mt-3" htmlFor="register-name">
                  Nama lengkap
                </label>
                <input
                  id="register-name"
                  className="form-control"
                  placeholder="Nama lengkap Anda"
                  autoComplete="name"
                  value={registration.name}
                  onChange={(e) =>
                    setRegistration({ ...registration, name: e.target.value })
                  }
                  minLength={2}
                  maxLength={120}
                  disabled={busy}
                  required
                />
                <label className="form-label mt-3" htmlFor="register-email">
                  Alamat email
                </label>
                <input
                  id="register-email"
                  type="email"
                  className="form-control"
                  placeholder="nama@peternakan.id"
                  autoComplete="username"
                  value={registration.email}
                  onChange={(e) =>
                    setRegistration({ ...registration, email: e.target.value })
                  }
                  maxLength={190}
                  disabled={busy}
                  required
                />
                <label className="form-label mt-3" htmlFor="register-password">
                  Kata sandi
                </label>
                <div className="auth-password">
                  <input
                    id="register-password"
                    type={showPassword ? "text" : "password"}
                    className="form-control"
                    placeholder="Minimal 12 karakter"
                    autoComplete="new-password"
                    aria-describedby="register-password-hint"
                    value={registration.password}
                    onChange={(e) =>
                      setRegistration({
                        ...registration,
                        password: e.target.value,
                      })
                    }
                    minLength={12}
                    maxLength={72}
                    disabled={busy}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={
                      showPassword
                        ? "Sembunyikan kata sandi"
                        : "Tampilkan kata sandi"
                    }
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <small className="auth-hint" id="register-password-hint">
                  Gunakan minimal 12 karakter yang sulit ditebak.
                </small>
                <label
                  className="form-label mt-3"
                  htmlFor="register-confirmation"
                >
                  Konfirmasi kata sandi
                </label>
                <input
                  id="register-confirmation"
                  type={showPassword ? "text" : "password"}
                  className="form-control"
                  placeholder="Ulangi kata sandi"
                  autoComplete="new-password"
                  value={registration.password_confirmation}
                  onChange={(e) =>
                    setRegistration({
                      ...registration,
                      password_confirmation: e.target.value,
                    })
                  }
                  minLength={12}
                  maxLength={72}
                  disabled={busy}
                  required
                />
                {status?.first_admin_required && (
                  <>
                    <label
                      className="form-label mt-3"
                      htmlFor="register-setup-token"
                    >
                      Kode penyiapan admin
                    </label>
                    <input
                      id="register-setup-token"
                      type="password"
                      className="form-control"
                      placeholder="Kode dari pengelola hosting"
                      autoComplete="off"
                      spellCheck={false}
                      value={registration.setup_token}
                      onChange={(e) =>
                        setRegistration({
                          ...registration,
                          setup_token: e.target.value,
                        })
                      }
                      maxLength={256}
                      disabled={busy}
                      required
                    />
                  </>
                )}
                {error && (
                  <div className="alert alert-danger mt-3" role="alert">
                    {error}
                  </div>
                )}
                <button
                  className="btn btn-primary w-100 mt-4"
                  disabled={
                    busy ||
                    statusBusy ||
                    !status ||
                    (status.first_admin_required && !status.setup_enabled)
                  }
                >
                  {busy
                    ? "Mendaftarkan akun…"
                    : status?.first_admin_required
                      ? "Buat akun admin"
                      : "Daftar sebagai karyawan"}
                  {busy ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <ArrowRight size={17} />
                  )}
                </button>
                {mode === "demo" && (
                  <p className="auth-hint mt-3 text-center">
                    Mode demo · pendaftaran disimpan hanya di browser ini.
                  </p>
                )}
              </form>
            )}
          </div>
        ) : (
          <form onSubmit={signIn} className="login-form">
            <span className="icon-box green">
              <Sprout />
            </span>
            <h2>Selamat datang kembali</h2>
            <p className="text-muted">
              Masuk untuk mulai mengelola peternakan Anda.
            </p>
            <label className="form-label mt-4" htmlFor="email">
              Alamat email
            </label>
            <input
              id="email"
              type="email"
              className="form-control"
              placeholder="nama@peternakan.id"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <label className="form-label mt-3" htmlFor="password">
              Kata sandi
            </label>
            <input
              id="password"
              type="password"
              className="form-control"
              placeholder="Masukkan kata sandi"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && (
              <div className="alert alert-danger mt-3" role="alert">
                {error}
              </div>
            )}
            <button className="btn btn-primary w-100 mt-4" disabled={busy}>
              {busy ? "Sedang masuk…" : "Masuk ke TernaKu"}
              <ArrowRight size={17} />
            </button>
            <div className="auth-register-link">
              <span>Belum punya akun?</span>
              <button type="button" onClick={openRegistration} disabled={busy}>
                Daftar akun
              </button>
            </div>
            <InstallApp />
            {mode === "demo" && (
              <div className="demo-login">
                <span>COBA DENGAN DATA CONTOH</span>
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  disabled={busy}
                  onClick={() => signIn(undefined, "admin@ternaku.id")}
                >
                  Sebagai admin
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  disabled={busy}
                  onClick={() => signIn(undefined, "sari@ternaku.id")}
                >
                  Sebagai karyawan
                </button>
                <small>Data demo disimpan hanya di browser ini.</small>
              </div>
            )}
            <p className="login-foot">
              <ShieldCheck size={15} /> Akses sesuai peran, pencatatan lebih
              terjaga.
            </p>
          </form>
        )}
      </section>
    </main>
  );
}

export function FarmArt() {
  return (
    <svg
      className="farm-art"
      viewBox="0 0 360 200"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="256" cy="57" r="29" fill="#F8D989" />
      <path
        d="M5 165c79-72 143-46 197-38 71 12 84-33 155-21v94H5z"
        fill="#B3CFA7"
      />
      <path
        d="M0 187c88-32 167-30 238-4 52 19 82-31 122-32v49H0z"
        fill="#7EA87C"
      />
      <path
        d="M215 200c-44-25-26-49-6-67h21c-33 41-9 47 35 67"
        fill="#D6D9AD"
      />
      <rect x="164" y="78" width="105" height="75" rx="3" fill="#FAF1D2" />
      <path d="M154 81l62-50 62 50z" fill="#588468" />
      <path
        d="M160 79l56-45 56 45"
        stroke="#365D43"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="199" y="106" width="33" height="47" rx="3" fill="#568261" />
      <path d="M201 110l29 40m0-40-29 40" stroke="#FAF1D2" strokeWidth="2" />
      <rect x="182" y="92" width="11" height="13" rx="2" fill="#98B39B" />
      <rect x="243" y="92" width="11" height="13" rx="2" fill="#98B39B" />
      <path d="M304 158v-55" stroke="#668359" strokeWidth="5" />
      <ellipse cx="305" cy="87" rx="25" ry="36" fill="#628D65" />
      <path
        d="M50 157v-24m44 24v-24m-44 8h44m-44 12h44"
        stroke="#F6F0D8"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <ellipse cx="124" cy="141" rx="20" ry="15" fill="#FFF9E5" />
      <circle cx="139" cy="123" r="10" fill="#FFF9E5" />
      <path d="M140 112c-7-12-12-1-4 4m3-3c7-13 15-3 4 4" fill="#BC7957" />
      <path d="M148 120l9 4-9 4" fill="#D9AD58" />
      <circle cx="141" cy="121" r="1.7" fill="#34523B" />
      <path
        d="M107 137l-14-10 5 17m20 9v8m11-8v8"
        stroke="#D3A853"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <ellipse
        cx="79"
        cy="170"
        rx="7"
        ry="9"
        transform="rotate(-15 79 170)"
        fill="#FFF5DE"
      />
      <ellipse
        cx="95"
        cy="176"
        rx="6"
        ry="8"
        transform="rotate(12 95 176)"
        fill="#EEDAB1"
      />
      <path
        d="M20 192v-33m0 14-9-8m9 16 10-9m290 18v-22m0 9-8-6m8 14 9-8"
        stroke="#496F4D"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M81 47c5-5 10-5 15 0m-7-6c5-5 10-5 15 0"
        stroke="#98B29A"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Workspace() {
  const {
    state,
    user,
    mode,
    loading,
    sessionRecovery,
    priceSync,
    error,
    logout,
    command,
    refresh,
  } = useFarm();
  const [bootstrapped, setBootstrapped] = useState(false);
  const [page, navigate] = usePageNavigation(
    navigation.map((item) => item.id),
    "dashboard",
    "",
    user?.role === "admin",
  );
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<string | null>(null);
  const [notifications, setNotifications] = useState(false);
  const [help, setHelp] = useState(false);
  const [notice, setNotice] = useState("");
  useBackLayer(mobile && user?.role === "admin", () => setMobile(false));
  useBackLayer(help && user?.role === "admin", () => setHelp(false));
  useBackLayer(notifications && user?.role === "admin", () =>
    setNotifications(false),
  );
  const go = (id: string) => {
    navigate(id);
    setMobile(false);
    setSearch("");
  };
  useEffect(() => {
    if (!loading) setBootstrapped(true);
  }, [loading]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  if (loading && !user && !bootstrapped)
    return (
      <div className="app-loading">
        <Sprout size={36} />
        <strong>Menyiapkan TernaKu…</strong>
      </div>
    );
  if (!user && sessionRecovery)
    return (
      <div className="app-loading session-recovery" role="status">
        <Sprout size={36} />
        <strong>Sambungkan kembali ke TernaKu</strong>
        <p>
          Akun Anda masih tersimpan. Periksa koneksi internet, lalu coba lagi.
        </p>
        <button
          className="btn btn-primary"
          disabled={priceSync.refreshing}
          onClick={() => void refresh().catch(() => {})}
        >
          {priceSync.refreshing ? "Menyambungkan…" : "Coba lagi"}
        </button>
        <button
          className="btn btn-link"
          disabled={loading}
          onClick={() => void logout()}
        >
          Masuk dengan akun lain
        </button>
      </div>
    );
  if (!user || !state) return <Login />;
  if (user.role === "employee") return <EmployeeWorkspace />;
  const menu = navigation.filter((n) => !n.admin || user.role === "admin");
  const current = menu.find((n) => n.id === page) || menu[0];
  const unread = state.notifications.filter(
    (n) => n.user_id === user.id && !n.read,
  );
  const price = activePrice(state);
  const isAdmin = user.role === "admin";
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="sidebar-shade"
          aria-label="Tutup navigasi"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <a
          href="#dashboard"
          onClick={(event) => {
            event.preventDefault();
            go("dashboard");
          }}
          className="brand-link"
          aria-label="TernaKu beranda"
        >
          <Brand />
        </a>
        <div className="workspace-select">
          <span className="workspace-avatar">
            <Sprout size={20} />
          </span>
          <div>
            <strong>Peternakan TernaKu</strong>
            <small>Ruang kerja {isAdmin ? "admin" : "karyawan"}</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <nav aria-label="Menu utama">
          {menu.map((n) => (
            <div key={n.id}>
              {n.group && <div className="nav-label">{n.group}</div>}
              <button
                className={`nav-item ${current.id === n.id ? "active" : ""}`}
                onClick={() => go(n.id)}
              >
                <n.icon size={19} />
                <span>{n.label}</span>
                {n.soon ? (
                  <span className="soon-badge">SEGERA</span>
                ) : current.id === n.id ? (
                  <span className="nav-dot" />
                ) : null}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span>
              <Leaf size={18} /> Tumbuh bersama TernaKu
            </span>
            <p>Pencatatan rapi, usaha lebih berarti.</p>
            <button onClick={() => setHelp(true)}>
              Panduan singkat <ArrowRight size={14} />
            </button>
          </div>
          <button
            className="user-switch"
            onClick={() => {
              setMobile(false);
              setProfileOpen(true);
            }}
            title="Buka profil dan pengaturan"
          >
            <Avatar user={user} />
            <span>
              <strong>{user.name}</strong>
              <small>{isAdmin ? "Administrator" : "Karyawan"}</small>
            </span>
            <Settings2 size={17} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="d-flex align-items-center gap-3">
            <button
              className="icon-button mobile-menu"
              aria-label="Buka navigasi"
              onClick={() => setMobile(true)}
            >
              <Menu size={22} />
            </button>
            <div className="breadcrumb-trail">
              <span>Ruang kerja</span>
              <ChevronRight size={13} />
              <strong>{current.label}</strong>
            </div>
          </div>
          <div className="topbar-right">
            <ThemeToggle compact />
            <div className="global-search">
              <Search size={17} />
              <input
                aria-label="Cari menu"
                placeholder="Cari di TernaKu…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>⌕</kbd>
              {search && (
                <div className="search-results">
                  {menu
                    .filter((n) =>
                      n.label.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((n) => (
                      <button key={n.id} onClick={() => go(n.id)}>
                        <n.icon size={17} />
                        {n.label}
                        <ArrowRight size={14} />
                      </button>
                    ))}
                  {!menu.some((n) =>
                    n.label.toLowerCase().includes(search.toLowerCase()),
                  ) && <p>Menu tidak ditemukan.</p>}
                </div>
              )}
            </div>
            <span className={`mode-tag ${mode === "demo" ? "demo" : ""}`}>
              <span />
              {mode === "demo" ? "Mode demo" : "Terhubung"}
            </span>
            <button
              className="icon-button help-button"
              aria-label="Panduan aplikasi"
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={19} />
            </button>
            <div className="notification-wrap">
              <button
                className="icon-button"
                aria-label={`Notifikasi, ${unread.length} belum dibaca`}
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={20} />
                {unread.length > 0 && <span className="notification-dot" />}
              </button>
              {notifications && (
                <section className="notification-panel">
                  <div>
                    <strong>Notifikasi</strong>
                    <button
                      className="icon-button"
                      aria-label="Tutup notifikasi"
                      onClick={() => setNotifications(false)}
                    >
                      <X size={17} />
                    </button>
                  </div>
                  {state.notifications
                    .filter((n) => n.user_id === user.id)
                    .slice(0, 8)
                    .map((n) => (
                      <button
                        key={n.id}
                        className={n.read ? "read" : ""}
                        onClick={async () => {
                          try {
                            await command("notification.read", { id: n.id });
                          } catch (e) {
                            setNotice((e as Error).message);
                          }
                        }}
                      >
                        <span className="notification-symbol">
                          <Wallet size={17} />
                        </span>
                        <span>
                          <strong>{n.title}</strong>
                          <p>{n.message}</p>
                          <small>{dateLabel(n.created_at, true)}</small>
                        </span>
                        {!n.read && <span className="unread-dot" />}
                      </button>
                    ))}
                  {state.notifications.filter((n) => n.user_id === user.id)
                    .length === 0 && (
                    <p className="p-4 text-muted">Belum ada notifikasi.</p>
                  )}
                </section>
              )}
            </div>
            <button
              className="icon-button"
              aria-label="Profil dan pengaturan"
              onClick={() => setProfileOpen(true)}
            >
              <Avatar user={user} size="sm" />
            </button>
          </div>
        </header>
        <main className="main-content" id="main-content">
          {error && (
            <div className="alert alert-warning d-flex align-items-center justify-content-between">
              {error}
              <button
                className="btn btn-sm btn-outline-secondary"
                onClick={() => void refresh().catch(() => {})}
              >
                Coba lagi
              </button>
            </div>
          )}
          {current.id === "dashboard" ? (
            <>
              <Dashboard go={go} open={setModal} />
              <PushNotifications />
            </>
          ) : current.id === "reports" ? (
            <Reports />
          ) : ["cattle", "incentives"].includes(current.id) ? (
            <div className="coming-soon-page">
              <div className="coming-illustration">
                <Sprout size={80} />
                <span>
                  <Leaf size={28} />
                </span>
              </div>
              <span className="eyebrow">SEGERA HADIR</span>
              <h1>
                {current.id === "cattle"
                  ? "Ruang baru untuk ternak Anda."
                  : "Apresiasi untuk setiap usaha."}
              </h1>
              <p>
                {current.id === "cattle"
                  ? "Manajemen kandang sapi akan hadir untuk melengkapi pengelolaan peternakan Anda."
                  : "Fitur insentif karyawan sedang disiapkan. Untuk saat ini, Anda dapat memantau hasil penjualan melalui laporan."}
              </p>
              <span className="status-pill neutral">Segera hadir</span>
              <button
                className="btn btn-primary mt-4"
                onClick={() => go("dashboard")}
              >
                Kembali ke ringkasan
                <ArrowRight size={17} />
              </button>
            </div>
          ) : (
            <Modules page={current.id} />
          )}
          <footer className="app-footer">
            <span>
              © {new Date().getFullYear()} TernaKu{" "}
              <span className="footer-dot">·</span> Peternakan dalam genggaman
            </span>
            <span>
              <span className="live-dot" />
              {mode === "demo"
                ? "Data contoh · tersimpan di browser"
                : "Data tersimpan online"}
            </span>
          </footer>
        </main>
      </div>
      {modal && <EntryModal kind={modal} onClose={() => setModal(null)} />}{" "}
      {profileOpen && <ProfileSettings onClose={() => setProfileOpen(false)} />}
      {notice && (
        <div className="app-toast" role="status">
          <Check size={18} />
          {notice}
          <button
            className="icon-button"
            onClick={() => setNotice("")}
            aria-label="Tutup"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {help && (
        <div className="modal-backdrop-custom" onClick={() => setHelp(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Panduan singkat"
            className="modal-dialog-custom help-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h4>Selamat datang di TernaKu</h4>
              <button
                className="icon-button"
                onClick={() => setHelp(false)}
                aria-label="Tutup panduan"
              >
                <X />
              </button>
            </div>
            <div className="modal-body">
              <p className="text-muted">
                Empat langkah untuk pencatatan harian yang rapi.
              </p>
              {[
                [
                  "1",
                  "Catat hasil panen",
                  "Masukkan butir, berat aktual, dan krat. Berat tidak harus 10 kg per krat.",
                ],
                [
                  "2",
                  "Ambil stok untuk dijual",
                  "Catat pengambilan. Stok gudang berkurang dan menjadi persediaan karyawan.",
                ],
                [
                  "3",
                  "Catat penjualan & cetak nota",
                  "Pilih telur yang dibawa. Harga aktif dan total dihitung otomatis.",
                ],
                [
                  "4",
                  "Pantau hasil usaha",
                  "Lihat laporan berdasarkan periode, lalu unduh PDF atau Excel.",
                ],
              ].map(([n, t, d]) => (
                <div className="help-step" key={n}>
                  <span>{n}</span>
                  <div>
                    <strong>{t}</strong>
                    <p>{d}</p>
                  </div>
                </div>
              ))}
              <div className="notice-box">
                Harga aktif: bagus{" "}
                {price ? money(price.good_price) : "belum diatur"}/kg · bentes{" "}
                {price
                  ? price.cracked_price === 0
                    ? "Gratis"
                    : `${money(price.cracked_price)}/kg`
                  : "belum diatur"}
                .
              </div>
              {mode === "demo" && (
                <p className="small text-muted mt-3">
                  Mode demo menggunakan data contoh di browser. Keluar untuk
                  mencoba akun karyawan. Pendaftaran karyawan memerlukan
                  persetujuan admin melalui menu Karyawan.
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-primary"
                onClick={() => setHelp(false)}
              >
                Siap, mulai mencatat
                <ArrowRight size={16} />
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function AccountWorkspace() {
  const { user } = useFarm();
  return <Workspace key={user ? `${user.id}:${user.role}` : "signed-out"} />;
}

export default function App() {
  return (
    <FarmProvider>
      <AccountWorkspace />
    </FarmProvider>
  );
}
