/* shotconv — turn a TV screenshot (8-bit PNG from /usr/local/bin/screenshot)
 * into something that looks right on a phone, on the TV itself.
 *
 *   shotconv <in.png> <out.jpg|out.png> [auto|hdr|raw] [jpeg quality]
 *
 * HDR sources reach the capture as an HDR (PQ) curve with normal BT.709
 * colours, so they look flat. "hdr" converts them the same way as this
 * ffmpeg chain, which matched the TV best:
 *   setparams=color_primaries=bt709:color_trc=smpte2084:colorspace=gbr:range=pc,
 *   zscale=t=linear:npl=100,format=gbrpf32le,
 *   tonemap=tonemap=mobius:param=0.5:desat=0,
 *   zscale=t=bt709:m=bt709:r=pc,format=rgb24
 * "auto" (default) converts only when the frame looks like HDR: SDR frames
 * nearly always reach full white somewhere, HDR captures do not (measured:
 * brightest 0.1% of pixels <= 201 for HDR, >= 247 for SDR). Threshold 215.
 * "raw" never converts. The decision goes to stderr.
 *
 * Image I/O: stb_image v2.30 / stb_image_write v1.16 (public domain,
 * nothings/stb commit c16853e).
 */
#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_PNG
#include "stb_image.h"
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define HDR_THRESHOLD 215

/* SMPTE ST 2084 (PQ) code value 0..1 -> linear light, 1.0 = 100 nits (npl=100). */
static double pq_to_linear(double e) {
    const double m1 = 2610.0 / 16384, m2 = 2523.0 / 4096 * 128;
    const double c1 = 3424.0 / 4096, c2 = 2413.0 / 4096 * 32, c3 = 2392.0 / 4096 * 32;
    double p = pow(e, 1.0 / m2);
    double y = pow(fmax(p - c1, 0.0) / (c2 - c3 * p), 1.0 / m1);
    return y * 10000.0 / 100.0;
}

/* ffmpeg vf_tonemap mobius(). Without HDR metadata ffmpeg assumes peak = 12
 * (ff_determine_signal_peak: 1200 nits at npl=100), so that is used here. */
static float mobius(float in, float j, double peak) {
    if (in <= j) return in;
    float a = -j * j * (peak - 1.0f) / (j * j - 2.0f * j + peak);
    float b = (j * j - 2.0f * j * peak + peak) / fmaxf(peak - 1.0f, 1e-6f);
    return (b * b + 2.0f * b * j + j * j) / (b - a) * (in + a) / (in + b);
}

/* zscale t=bt709 from display-linear light: zimg uses the BT.1886 display
 * gamma (pure 1/2.4 power), not the camera OETF with its linear toe. Verified
 * against ffmpeg on a grey ramp. */
static double oetf709(double x) {
    return pow(x, 1.0 / 2.4);
}

/* Brightest channel at the 99.9th percentile, from a subsample of pixels. */
static int bright_p999(const unsigned char *px, int w, int h) {
    long hist[256] = {0}, n = 0;
    for (int y = 0; y < h; y += 2)
        for (int x = 0; x < w; x += 2) {
            const unsigned char *p = px + 3L * (y * (long)w + x);
            int m = p[0] > p[1] ? p[0] : p[1];
            if (p[2] > m) m = p[2];
            hist[m]++; n++;
        }
    long want = n - n / 1000, acc = 0;
    for (int v = 0; v < 256; v++) { acc += hist[v]; if (acc >= want) return v; }
    return 255;
}

static void convert_hdr(unsigned char *px, long count) {
    static float lin[256];
    static unsigned char out[65537]; /* fine steps: the 1/2.4 curve is steep near black */
    for (int v = 0; v < 256; v++) lin[v] = (float)pq_to_linear(v / 255.0);
    for (int i = 0; i <= 65536; i++) out[i] = (unsigned char)lrint(oetf709(i / 65536.0) * 255.0);
    const double peak = 12.0;
    for (long i = 0; i < count; i++) {
        unsigned char *p = px + 3 * i;
        float r = lin[p[0]], g = lin[p[1]], b = lin[p[2]];
        float sig = fmaxf(fmaxf(r, g), fmaxf(b, 1e-6f));
        float k = mobius(sig, 0.5f, peak) / sig;
        float c[3] = { r * k, g * k, b * k };
        for (int ch = 0; ch < 3; ch++) {
            float x = c[ch] < 0 ? 0 : c[ch] > 1 ? 1 : c[ch];
            p[ch] = out[(int)lrintf(x * 65536.0f)];
        }
    }
}

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: %s in.png out.jpg|out.png [auto|hdr|raw] [quality]\n", argv[0]);
        return 2;
    }
    const char *mode = argc > 3 ? argv[3] : "auto";
    int quality = argc > 4 ? atoi(argv[4]) : 92;
    int w, h, n;
    unsigned char *px = stbi_load(argv[1], &w, &h, &n, 3);
    if (!px) { fprintf(stderr, "cannot read %s: %s\n", argv[1], stbi_failure_reason()); return 1; }

    int p999 = bright_p999(px, w, h), hdr;
    if (!strcmp(mode, "hdr")) hdr = 1;
    else if (!strcmp(mode, "raw")) hdr = 0;
    else hdr = p999 < HDR_THRESHOLD;
    fprintf(stderr, "%s: %s (brightest 0.1%% = %d)\n", mode, hdr ? "converted from HDR" : "left as is", p999);
    if (hdr) convert_hdr(px, (long)w * h);

    size_t len = strlen(argv[2]);
    int ok = len > 4 && !strcmp(argv[2] + len - 4, ".png")
        ? stbi_write_png(argv[2], w, h, 3, px, w * 3)
        : stbi_write_jpg(argv[2], w, h, 3, px, quality);
    stbi_image_free(px);
    if (!ok) { fprintf(stderr, "cannot write %s\n", argv[2]); return 1; }
    return 0;
}
