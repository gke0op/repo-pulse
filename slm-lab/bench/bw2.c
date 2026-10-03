#include <stdio.h>
#include <stdlib.h>
#include <omp.h>
int main(){size_t n=(size_t)1<<28; float*a=aligned_alloc(64,n*4);
#pragma omp parallel for
for(size_t i=0;i<n;i++)a[i]=i&7;
double best=0;for(int r=0;r<5;r++){double t=omp_get_wtime();float s=0;
#pragma omp parallel for simd reduction(+:s)
for(size_t i=0;i<n;i++)s+=a[i];
t=omp_get_wtime()-t;double g=n*4/t/1e9;if(g>best)best=g;fprintf(stderr,"%f",s);}
printf("%d-thread read BW: %.1f GB/s\n",omp_get_max_threads(),best);}
