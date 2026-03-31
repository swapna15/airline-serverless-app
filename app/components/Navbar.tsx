"use client";

import { signOutAction } from "@/app/actions/auth";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Home" },
  { href: "/search", label: "Search Flights" },
  { href: "/manage", label: "Manage" },
  { href: "/my-bookings", label: "My Bookings" },
];

type NavbarProps = {
  user?: { name?: string | null; email?: string | null } | null;
};

export default function Navbar({ user }: NavbarProps) {
  const pathname = usePathname();

  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
      <Link href="/" className="text-blue-600 font-bold text-lg tracking-tight mr-4">
        ✈ AirApp
      </Link>
      <div className="flex items-center gap-5 flex-1">
        {links.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`text-sm font-medium transition ${
              pathname === href
                ? "text-blue-600 border-b-2 border-blue-600 pb-0.5"
                : "text-gray-600 hover:text-blue-600"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-3 ml-auto">
        {user ? (
          <>
            <span className="text-sm text-gray-700 font-medium hidden sm:block">
              {user.name ?? user.email}
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-sm text-gray-500 hover:text-red-600 transition font-medium"
              >
                Sign Out
              </button>
            </form>
          </>
        ) : (
          <>
            <Link
              href="/login"
              className="text-sm text-gray-600 hover:text-blue-600 font-medium transition"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-1.5 rounded-lg transition"
            >
              Register
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
