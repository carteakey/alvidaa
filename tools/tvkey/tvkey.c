/* tvkey — inject one remote key on the TV, through /dev/uinput.
 *
 * Why this exists: writing to /dev/input/eventN does NOT inject input. Those
 * nodes are read-only for consumers; the kernel discards writes to them. The
 * alvidaa CLI's first device lane did exactly that, so every key it "sent" was
 * silently dropped — measured 2026-11-13 on the reference unit: HOME, DOWN,
 * ENTER and RIGHT all produced no frame change beyond the clock ticking.
 *
 * /dev/uinput is the lane that works: create a virtual keyboard, emit the key,
 * destroy it. The vendor's input daemon sees a real device and dispatches the
 * key exactly as it would from the remote.
 *
 *   tvkey <linux-key-code> [count]
 *
 * Build: tools/tvkey/build.sh (zig cc, static armv7).
 */
#include <fcntl.h>
#include <linux/input.h>
#include <linux/uinput.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

static void emit(int fd, int type, int code, int value) {
    struct input_event ev;
    memset(&ev, 0, sizeof(ev));
    ev.type = (unsigned short)type;
    ev.code = (unsigned short)code;
    ev.value = value;
    if (write(fd, &ev, sizeof(ev)) != (ssize_t)sizeof(ev)) {
        perror("write");
    }
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: tvkey <linux-key-code> [count]\n");
        return 2;
    }
    int code = atoi(argv[1]);
    int count = argc > 2 ? atoi(argv[2]) : 1;
    if (code <= 0 || code >= KEY_MAX) {
        fprintf(stderr, "tvkey: key code %d out of range\n", code);
        return 2;
    }
    if (count < 1) count = 1;
    if (count > 10) count = 10; /* single presses by hand, never a hold */

    int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
    if (fd < 0) {
        perror("tvkey: open /dev/uinput");
        return 1;
    }

    if (ioctl(fd, UI_SET_EVBIT, EV_KEY) < 0) { perror("UI_SET_EVBIT"); return 1; }
    if (ioctl(fd, UI_SET_KEYBIT, code) < 0) { perror("UI_SET_KEYBIT"); return 1; }

    struct uinput_setup setup;
    memset(&setup, 0, sizeof(setup));
    setup.id.bustype = BUS_USB;
    setup.id.vendor = 0x1d6b;
    setup.id.product = 0x0104;
    snprintf(setup.name, UINPUT_MAX_NAME_SIZE, "alvidaa-key");
    if (ioctl(fd, UI_DEV_SETUP, &setup) < 0) { perror("UI_DEV_SETUP"); return 1; }
    if (ioctl(fd, UI_DEV_CREATE) < 0) { perror("UI_DEV_CREATE"); return 1; }

    /* Let the vendor's input daemon notice the new device before we type. */
    usleep(150000);

    for (int i = 0; i < count; i++) {
        emit(fd, EV_KEY, code, 1);
        emit(fd, EV_SYN, SYN_REPORT, 0);
        usleep(30000);
        emit(fd, EV_KEY, code, 0);
        emit(fd, EV_SYN, SYN_REPORT, 0);
        usleep(60000);
    }

    usleep(100000);
    ioctl(fd, UI_DEV_DESTROY);
    close(fd);
    return 0;
}
