# Projectile Motion Lab

An interactive projectile motion simulator that runs in the browser. It has no build step and no dependencies: just `index.html`, `style.css` and `app.js`.

## Live demos
- **[Model 1](https://projectile-motion-chi.vercel.app/)**: the first version
- **[Model 2](https://projectile-motion-lab-woad.vercel.app/)**: this repo. It adds 4-decimal precision, the exact peak (Vy = 0) moment and 5 animation styles

## Features
- **Adjustable precision.** Shows 2 to 6 decimals; the default is 4 (0.0001). The time step can be as small as 0.000001 s.
- **Exact peak moment (Vy = 0).** Shows t = Vy0 / g with x, y, Vx, Vy and speed at that instant. The table always includes this exact row.
- **Five animation styles:** Classic, Neon trail, Velocity vectors, Stroboscope and Blueprint.
- **Playback controls:** play/pause, step through rows, a time scrubber, 0.1× to 4× speed, and an option to pause at the peak.
- **Virtual-scrolling table.** It can show more than 100,000 rows without slowing down, includes the exact peak and landing rows, and can be exported to CSV.
- **More:** clicking a table row jumps the animation to that time. There is a dark/light theme, links can be shared because the inputs are kept in the URL, and keyboard shortcuts work (Space, ← →).

## Physics
- g = 9.81 m/s², with no air resistance.
- Vx = v·cos θ + wind, and Vy(t) = v·sin θ − g·t
- x(t) = Vx·t, and y(t) = v·sin θ·t − ½·g·t²
- Peak time t = Vy0 / g, maximum height H = Vy0² / 2g, flight time T = 2·Vy0 / g, and range R = Vx·T

## Run locally
Open the folder with any static server, for example `npx serve .`, and visit the URL it prints.

## Deploy
Push the folder to GitHub, then import the repo on Vercel. Choose the **Other** framework preset and leave the build command empty.
