/* Cross-language check: does the C b64url decoder + TweetNaCl verify a receipt
   produced by packages/vendx-protocol? Uses the SAME decode logic as verifier.cpp. */
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include "tweetnacl.h"

void randombytes(unsigned char *x, unsigned long long n){ for(unsigned long long i=0;i<n;i++) x[i]=0; }

static int b64uVal(char c){
  if(c>='A'&&c<='Z')return c-'A';
  if(c>='a'&&c<='z')return c-'a'+26;
  if(c>='0'&&c<='9')return c-'0'+52;
  if(c=='-')return 62; if(c=='_')return 63; return -1;
}
static int b64uDecode(const char*in,size_t inLen,uint8_t*out,size_t outCap){
  uint32_t acc=0; int bits=0; size_t n=0;
  for(size_t i=0;i<inLen;i++){ int v=b64uVal(in[i]); if(v<0)return -1;
    acc=(acc<<6)|(uint32_t)v; bits+=6;
    if(bits>=8){ bits-=8; if(n>=outCap)return -1; out[n++]=(uint8_t)((acc>>bits)&0xFF);} }
  return (int)n;
}

int main(int argc,char**argv){
  if(argc<3){fprintf(stderr,"need <receipt> <pubkey_b64u>\n");return 2;}
  const char*hdr=argv[1]; const char*pkb=argv[2];
  uint8_t pk[32];
  if(b64uDecode(pkb,strlen(pkb),pk,32)!=32){printf("FAIL pubkey decode\n");return 1;}
  const char*dot=strchr(hdr,'.'); if(!dot){printf("FAIL no dot\n");return 1;}
  size_t bodyLen=(size_t)(dot-hdr);
  uint8_t sig[64];
  if(b64uDecode(dot+1,strlen(dot+1),sig,64)!=64){printf("FAIL sig decode\n");return 1;}
  uint8_t sm[64+512], m[64+512]; unsigned long long mlen=0;
  memcpy(sm,sig,64); memcpy(sm+64,hdr,bodyLen);
  int rc=crypto_sign_open(m,&mlen,sm,64+bodyLen,pk);
  if(rc!=0){printf("VERIFY_FAIL\n");return 1;}
  uint8_t json[512]; int jl=b64uDecode(hdr,bodyLen,json,511);
  if(jl<=0){printf("FAIL body decode\n");return 1;}
  json[jl]='\0';
  printf("VERIFY_OK body=%s\n",(char*)json);
  return 0;
}
