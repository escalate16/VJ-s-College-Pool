# VJ's College Pool

Same pool as VJ's Pool (same rules, fees, payouts, confidence rounds, props, winner letters, Football Crush, survivor, squares, chat), for college football. It is a **separate project with its own database, players and money**.

## Set it up (about 10 minutes)
1. Create a new GitHub repo (for example `VJ-College-Pool`) and upload everything in this folder.
2. In Vercel, add a **new project** from that repo.
3. In the new project, open Storage, create a **new Neon database** and connect it. Do not reuse the NFL pool's database or the two pools will share players and money.
4. Add the same environment variables you set for the NFL pool: OWNER_EMAIL, SESSION_SECRET (Secret type), INVITE_CODE, ADMIN_EMAILS, optionally ANTHROPIC_API_KEY, RESEND_API_KEY, MAIL_FROM, TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM. You may use a different INVITE_CODE.
5. Deploy. Sign in as the owner, open Admin, and tap **Load games now**.

## How games get added
- Each week the pool adds up to 12 featured games on its own: games with a Top 25 team, ranked-vs-ranked first.
- Bowl games with a Top 25 team go in "Bowl season". College Football Playoff games go in the four playoff rounds: First Round (19), Quarterfinals (20), Semifinals (21) and National Championship (22).
- Rounds 19 to 21 are total-points rounds. The National Championship uses squares.
- Scores, kickoff times, spreads and over/unders update automatically from ESPN's free feed.
- Delete any game you do not want, or add extras with "Add a game".
- The fantasy game is NFL-only and is turned off in this edition.

Note: the Top 25 and playoff matching reads ESPN's public feed. Check the first weeks and the playoff rounds, and add any missing game by hand.
ok
