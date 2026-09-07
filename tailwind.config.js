/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		opacity: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [i, `${i / 100}`])),
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			// DOS palette, CSS-variable driven: light mode swaps the variables
  			// under html.light (see index.css) so every color utility below
  			// remaps without touching component code. Values in :root replicate
  			// Tailwind's default palette exactly, so dark mode is unchanged.
  			black: 'rgb(var(--c-black) / <alpha-value>)',
  			green: {
  				200: 'rgb(var(--c-green-200) / <alpha-value>)',
  				300: 'rgb(var(--c-green-300) / <alpha-value>)',
  				400: 'rgb(var(--c-green-400) / <alpha-value>)',
  				500: 'rgb(var(--c-green-500) / <alpha-value>)',
  				600: 'rgb(var(--c-green-600) / <alpha-value>)',
  				700: 'rgb(var(--c-green-700) / <alpha-value>)',
  				800: 'rgb(var(--c-green-800) / <alpha-value>)',
  				900: 'rgb(var(--c-green-900) / <alpha-value>)'
  			},
  			emerald: {
  				200: 'rgb(var(--c-emerald-200) / <alpha-value>)',
  				300: 'rgb(var(--c-emerald-300) / <alpha-value>)',
  				400: 'rgb(var(--c-emerald-400) / <alpha-value>)',
  				500: 'rgb(var(--c-emerald-500) / <alpha-value>)',
  				600: 'rgb(var(--c-emerald-600) / <alpha-value>)',
  				700: 'rgb(var(--c-emerald-700) / <alpha-value>)',
  				800: 'rgb(var(--c-emerald-800) / <alpha-value>)',
  				900: 'rgb(var(--c-emerald-900) / <alpha-value>)'
  			},
  			cyan: {
  				200: 'rgb(var(--c-cyan-200) / <alpha-value>)',
  				300: 'rgb(var(--c-cyan-300) / <alpha-value>)',
  				400: 'rgb(var(--c-cyan-400) / <alpha-value>)',
  				500: 'rgb(var(--c-cyan-500) / <alpha-value>)',
  				600: 'rgb(var(--c-cyan-600) / <alpha-value>)',
  				700: 'rgb(var(--c-cyan-700) / <alpha-value>)',
  				800: 'rgb(var(--c-cyan-800) / <alpha-value>)',
  				900: 'rgb(var(--c-cyan-900) / <alpha-value>)'
  			},
  			amber: {
  				200: 'rgb(var(--c-amber-200) / <alpha-value>)',
  				300: 'rgb(var(--c-amber-300) / <alpha-value>)',
  				400: 'rgb(var(--c-amber-400) / <alpha-value>)',
  				500: 'rgb(var(--c-amber-500) / <alpha-value>)',
  				600: 'rgb(var(--c-amber-600) / <alpha-value>)',
  				700: 'rgb(var(--c-amber-700) / <alpha-value>)',
  				800: 'rgb(var(--c-amber-800) / <alpha-value>)',
  				900: 'rgb(var(--c-amber-900) / <alpha-value>)'
  			},
  			red: {
  				200: 'rgb(var(--c-red-200) / <alpha-value>)',
  				300: 'rgb(var(--c-red-300) / <alpha-value>)',
  				400: 'rgb(var(--c-red-400) / <alpha-value>)',
  				500: 'rgb(var(--c-red-500) / <alpha-value>)',
  				600: 'rgb(var(--c-red-600) / <alpha-value>)',
  				700: 'rgb(var(--c-red-700) / <alpha-value>)',
  				800: 'rgb(var(--c-red-800) / <alpha-value>)',
  				900: 'rgb(var(--c-red-900) / <alpha-value>)'
  			},
  			fuchsia: {
  				200: 'rgb(var(--c-fuchsia-200) / <alpha-value>)',
  				300: 'rgb(var(--c-fuchsia-300) / <alpha-value>)',
  				400: 'rgb(var(--c-fuchsia-400) / <alpha-value>)',
  				500: 'rgb(var(--c-fuchsia-500) / <alpha-value>)',
  				600: 'rgb(var(--c-fuchsia-600) / <alpha-value>)',
  				700: 'rgb(var(--c-fuchsia-700) / <alpha-value>)',
  				800: 'rgb(var(--c-fuchsia-800) / <alpha-value>)',
  				900: 'rgb(var(--c-fuchsia-900) / <alpha-value>)'
  			},
  			slate: {
  				200: 'rgb(var(--c-slate-200) / <alpha-value>)',
  				300: 'rgb(var(--c-slate-300) / <alpha-value>)',
  				400: 'rgb(var(--c-slate-400) / <alpha-value>)',
  				500: 'rgb(var(--c-slate-500) / <alpha-value>)',
  				600: 'rgb(var(--c-slate-600) / <alpha-value>)',
  				700: 'rgb(var(--c-slate-700) / <alpha-value>)',
  				800: 'rgb(var(--c-slate-800) / <alpha-value>)',
  				900: 'rgb(var(--c-slate-900) / <alpha-value>)'
  			},
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		fontFamily: {
  			heading: ['var(--font-heading)'],
  			body: ['var(--font-body)'],
  			display: ['var(--font-display)'],
  			mono: ['var(--font-mono)']
  		},
  		keyframes: {
  			// Terminal cursor for the $HUB header (mirrors hubconnect/web).
  			blink: {
  				'0%, 49%': { opacity: '1' },
  				'50%, 100%': { opacity: '0' }
  			},
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			blink: 'blink 1s step-end infinite',
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}
