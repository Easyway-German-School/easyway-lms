"use client"

import { ButtonHTMLAttributes } from "react"

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost"
}

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "rounded-2xl bg-[#FF6600] text-white shadow-lg shadow-[#FF6600]/20 hover:bg-[#FF7722] focus:ring-4 focus:ring-[#FF6600]/20",
  secondary: "rounded-2xl border border-slate-200 bg-white text-[#0F172A] hover:bg-slate-50 focus:ring-4 focus:ring-slate-200",
  ghost: "rounded-2xl bg-transparent text-[#0F172A] hover:bg-slate-100 focus:ring-4 focus:ring-slate-200",
}

export function Button({ variant = "primary", className = "", children, ...props }: ButtonProps) {
  return (
    <button className={`${variantClasses[variant]} ${className} inline-flex items-center justify-center px-4 py-3 text-sm font-semibold transition`} {...props}>
      {children}
    </button>
  )
}
