"use client";
import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

/** This reveals only what the user is typing; saved passwords are never loaded. */
export default function PasswordInput({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const [visible, setVisible] = useState(false);
  return <div className="input-group">
    <input className="form-control" type={visible ? "text" : "password"} autoComplete="new-password" aria-label={label} {...props} />
    <button className="btn btn-outline-secondary" type="button" style={{ minWidth: 48, minHeight: 48 }}
      aria-label={`${visible ? "Sembunyikan" : "Tampilkan"} ${label.toLowerCase()}`} aria-pressed={visible}
      disabled={props.disabled} onClick={() => setVisible(!visible)}>
      {visible ? <EyeOff size={19} /> : <Eye size={19} />}
    </button>
  </div>;
}
