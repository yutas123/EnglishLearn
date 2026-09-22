import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        highlight: "#ef4444",
      },
    },
  },
  plugins: [],
};

export default config;
