import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      boxShadow: {
        soft: "0 18px 45px rgba(15, 23, 42, 0.08)",
      },
      colors: {
        ink: "#0f172a",
        muted: "#64748b",
        panel: "#f8fafc",
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#2563eb",
          600: "#1d4ed8",
          700: "#1e40af",
          900: "#172554"
        }
      }
    }
  },
  plugins: []
};

export default config;
