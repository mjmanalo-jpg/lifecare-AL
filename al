#!/bin/bash
# Assisted Living Portal - Unix CLI
# Run from anywhere: ./al [command]

cd "$(dirname "$0")"
node cli.js "$@"
