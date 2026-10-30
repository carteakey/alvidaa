#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <linux/fb.h>
#include <stdio.h>
int main(void){
  int fd = open("/dev/fb0", O_RDONLY);
  if (fd < 0) { perror("open"); return 1; }
  int len = 7680 * 1080;
  char *m = mmap(0, len, PROT_READ, MAP_SHARED, fd, 0);
  if (m == (void*)-1) { perror("mmap"); return 1; }
  ssize_t w = 0;
  while (w < len) {
    ssize_t n = write(1, m + w, len - w);
    if (n <= 0) { perror("write"); return 1; }
    w += n;
  }
  return 0;
}
