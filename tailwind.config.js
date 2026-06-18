/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        bg: '#f7f6fb', surface: '#ffffff', 'surface-2': '#f0eef7',
        border: '#e4e1f0', accent: '#7c5cfc',
        green: '#00b894', red: '#e17055', orange: '#e67e22', pink: '#e84393',
      },
      borderRadius: { card: '12px' },
    },
  },
};
