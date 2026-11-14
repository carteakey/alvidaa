alive() {
    [ -n "$1" ] && [ -d "/proc/$1" ] || return 1
    grep -qa "$2" "/proc/$1/cmdline" 2>/dev/null
}
