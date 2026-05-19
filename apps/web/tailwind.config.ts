import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "var(--color-brand-muted)",
          100: "#dbeafe",
          600: "var(--color-brand)",
          700: "var(--color-brand-hover)",
          900: "#1e3a8a",
        },
        page: "var(--color-page)",
        sheet: "var(--color-sheet)",
        border: {
          DEFAULT: "var(--color-border)",
          dark: "var(--color-border-dark)",
        },
        slateText: "var(--color-text)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        card: "var(--shadow-card)",
        soft: "var(--shadow-soft)",
        dropdown: "var(--shadow-dropdown)",
        modal: "var(--shadow-modal)",
        shell: "0 16px 40px rgba(15, 23, 42, 0.08)",
      },
      transitionDuration: {
        fast: "var(--motion-duration-fast)",
      },
      transitionTimingFunction: {
        standard: "var(--motion-ease-standard)",
      },
    },
  },
  plugins: [],
};

export default config;
