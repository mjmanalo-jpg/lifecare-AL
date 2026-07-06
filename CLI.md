# 🚀 Assisted Living Portal - Global CLI

Run commands from anywhere in your system!

## Installation

The CLI is ready to use immediately.

## Usage

### Windows
```bash
al start          # Start dev server
al build          # Build for production
al install        # Install dependencies
al clean          # Clean build
al status         # Show project status
al git "message"  # Commit and push
al help           # Show help
```

### Mac/Linux
```bash
./al start
./al build
./al install
./al clean
./al status
./al git "message"
./al help
```

### Using npm
```bash
npm run cli start
npm run cli build
npm run cli git "message"
```

## Commands

| Command | What it do |
|---------|-----------|
| `start` | Start dev server on http://localhost:3000 |
| `build` | Build for production |
| `install` | Install all dependencies |
| `clean` | Delete .next and node_modules |
| `test` | Run tests |
| `status` | Show git status |
| `git [msg]` | Commit all changes and push |
| `help` | Show all commands |

## Examples

```bash
# Start dev
al start

# Build production
al build

# Commit changes
al git "Add new features"

# Check status
al status

# Clean everything
al clean
al install
al start
```

## Where to Run

Run CLI from **anywhere** on your computer:
```bash
cd C:\Users\You\Desktop
al start

cd /home/user/documents
./al build

cd D:\Projects
npm run cli git "Updated"
```

## Setup (One Time)

### Windows - Add to PATH
Right-click Start → System → Advanced system settings → Environment Variables
- Add: `C:\Users\ResolutAI\Documents\assisted-living` to PATH
- Now run from anywhere: `al start`

### Mac/Linux - Create alias
```bash
alias al='/path/to/assisted-living/al'
echo "alias al='/path/to/assisted-living/al'" >> ~/.bashrc
```

## Always Running Routine

Set up cron job (Mac/Linux):
```bash
# Edit crontab
crontab -e

# Add this line (runs every hour):
0 * * * * /path/to/assisted-living/al status
```

Or use Task Scheduler (Windows):
1. Open Task Scheduler
2. Create Basic Task
3. Name: "AL Portal Check"
4. Trigger: Hourly
5. Action: Run `C:\Users\ResolutAI\Documents\assisted-living\al.bat status`

Done! 🎉
