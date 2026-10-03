#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <immintrin.h>
static double now(){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec+t.tv_nsec*1e-9;}
int main(){size_t n=(size_t)1<<28; float*a=aligned_alloc(64,n*4); for(size_t i=0;i<n;i++)a[i]=i&7;
 double best=0; for(int r=0;r<5;r++){double t=now(); __m512 s0=_mm512_setzero_ps(),s1=s0,s2=s0,s3=s0;
 _Pragma("omp parallel for reduction(+:x)") for(size_t i=0;i<n;i+=64){s0=_mm512_add_ps(s0,_mm512_load_ps(a+i));s1=_mm512_add_ps(s1,_mm512_load_ps(a+i+16));s2=_mm512_add_ps(s2,_mm512_load_ps(a+i+32));s3=_mm512_add_ps(s3,_mm512_load_ps(a+i+48));}
 t=now()-t; float o=_mm512_reduce_add_ps(_mm512_add_ps(_mm512_add_ps(s0,s1),_mm512_add_ps(s2,s3))); double g=n*4/t/1e9; if(g>best)best=g; fprintf(stderr,"%f\n",o);}
 printf("1-thread read BW: %.1f GB/s\n",best);}
