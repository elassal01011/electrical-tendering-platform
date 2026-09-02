import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#d9e6ff",
          500: "#2f5fd6",
          600: "#274ea8",
          700: "#1f3f87",
          900: "#111e3c",
        },
      },
    },
  },
  plugins: [],
};
export default config;
