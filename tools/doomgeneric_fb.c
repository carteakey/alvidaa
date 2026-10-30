// doomgeneric framebuffer backend for Hisense VIDAA (MStar FB0, 32bpp)
// draws DG_ScreenBuffer scaled to the visible framebuffer, nearest neighbor
// input: the Bluetooth remote arrives as standard EV_KEY on /dev/input/event3
#include "doomgeneric.h"
#include "doomkeys.h"
#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <linux/fb.h>
#include <linux/input.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static int fb_fd = -1;
static unsigned int *fb = NULL;
static size_t fb_len = 0;
static int fb_w = 1920, fb_h = 1080;
static int fb_stride_px = 1920;
static int *xmap = NULL; // dst x -> src x
static int *ymap = NULL; // dst y -> src y
static int ev_fd = -1;

static int map_key(unsigned short code)
{
    switch (code)
    {
    case 103: return KEY_UPARROW;    // KEY_UP
    case 108: return KEY_DOWNARROW;  // KEY_DOWN
    case 105: return KEY_LEFTARROW;  // KEY_LEFT
    case 106: return KEY_RIGHTARROW; // KEY_RIGHT
    case 352: return KEY_ENTER;      // KEY_OK
    case 158:                        // KEY_BACK (unconfirmed)
    case 1:                          // KEY_ESC (unconfirmed)
        return KEY_ESCAPE;
    default:
        if (code >= 30 && code <= 54) // KEY_A..KEY_Z
            return 'a' + (code - 30);
        if (code >= 2 && code <= 10) // KEY_1..KEY_9
            return '1' + (code - 2);
        if (code == 11)
            return '0';
        // unknown: log to doom.log so the map teaches itself
        fprintf(stderr, "unmapped keycode %d\n", code);
        return 0;
    }
}

void DG_Init()
{
    fb_fd = open("/dev/fb0", O_RDWR);
    if (fb_fd < 0)
    {
        // fall through the fb devices
        for (int i = 1; i < 4 && fb_fd < 0; i++)
        {
            char path[32];
            snprintf(path, sizeof(path), "/dev/fb%d", i);
            fb_fd = open(path, O_RDWR);
        }
        if (fb_fd < 0)
        {
            perror("open fb");
            exit(1);
        }
    }

    struct fb_var_screeninfo vinfo;
    struct fb_fix_screeninfo finfo;
    if (ioctl(fb_fd, FBIOGET_VSCREENINFO, &vinfo))
    {
        perror("FBIOGET_VSCREENINFO");
        exit(1);
    }
    if (ioctl(fb_fd, FBIOGET_FSCREENINFO, &finfo))
    {
        perror("FBIOGET_FSCREENINFO");
        exit(1);
    }

    fb_w = vinfo.xres;
    fb_h = vinfo.yres;
    fb_stride_px = finfo.line_length / 4;

    fb_len = finfo.smem_len;
    if (fb_len < (size_t)(fb_stride_px * fb_h * 4))
        fb_len = (size_t)fb_stride_px * fb_h * 4;

    fb = mmap(0, fb_len, PROT_READ | PROT_WRITE, MAP_SHARED, fb_fd, 0);
    if (fb == MAP_FAILED)
    {
        perror("mmap fb");
        exit(1);
    }

    xmap = malloc(sizeof(int) * fb_w);
    ymap = malloc(sizeof(int) * fb_h);
    for (int x = 0; x < fb_w; x++)
        xmap[x] = x * DOOMGENERIC_RESX / fb_w;
    for (int y = 0; y < fb_h; y++)
        ymap[y] = y * DOOMGENERIC_RESY / fb_h;

    ev_fd = open("/dev/input/event3", O_RDONLY | O_NONBLOCK); // Bluetooth remote
    if (ev_fd < 0)
        fprintf(stderr, "no remote input: /dev/input/event3\n");

    fprintf(stderr, "fb: %dx%d stride %d px, %d bpp\n", fb_w, fb_h, fb_stride_px, vinfo.bits_per_pixel);
}

void DG_DrawFrame()
{
    if (!fb)
        return;
    for (int y = 0; y < fb_h; y++)
    {
        unsigned int *dst = fb + (size_t)y * fb_stride_px;
        unsigned int *src = DG_ScreenBuffer + (size_t)ymap[y] * DOOMGENERIC_RESX;
        for (int x = 0; x < fb_w; x++)
        {
            // DG pixel is 0x00RRGGBB; fb is little-endian BGRA in memory
            dst[x] = 0xFF000000u | src[xmap[x]];
        }
    }
}

void DG_SleepMs(uint32_t ms)
{
    struct timespec ts;
    ts.tv_sec = ms / 1000;
    ts.tv_nsec = (ms % 1000) * 1000000;
    nanosleep(&ts, NULL);
}

uint32_t DG_GetTicksMs()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint32_t)(ts.tv_sec * 1000 + ts.tv_nsec / 1000000);
}

int DG_GetKey(int *pressed, unsigned char *doomKey)
{
    struct input_event ev;
    if (ev_fd < 0)
        return 0;
    ssize_t n = read(ev_fd, &ev, sizeof(ev));
    if (n != (ssize_t)sizeof(ev))
        return 0; // queue empty or partial read
    if (ev.type != 1) // EV_KEY only
        return 0;
    int k = map_key(ev.code);
    if (!k)
        return 0;
    *pressed = (ev.value != 0);
    *doomKey = (unsigned char)k;
    return 1;
}

void DG_SetWindowTitle(const char *title)
{
    (void)title;
}

int main(int argc, char **argv)
{
    doomgeneric_Create(argc, argv);

    while (1)
    {
        doomgeneric_Tick();
    }

    return 0;
}
