import type { SVGProps } from 'react';

export function CircleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 -10 350 350.5" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M170,61.75c-60.06,0-108.75,48.69-108.75,108.75s48.69,108.75,108.75,108.75,108.75-48.69,108.75-108.75-48.69-108.75-108.75-108.75ZM170.25.25c93.89,0,170,76.11,170,170s-76.11,170-170,170S.25,264.14.25,170.25,76.36.25,170.25.25Z" />
    </svg>
  );
}

export function GlassIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 -30 487.75 530.57" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M260,170.5c0-49.71-40.29-90-90-90s-90,40.29-90,90,40.29,90,90,90,90-40.29,90-90ZM170.25.25c93.89,0,170,76.11,170,170s-76.11,170-170,170S.25,264.14.25,170.25,76.36.25,170.25.25Z" />
      <rect x="206.45" y="325.89" width="293.35" height="76.11" transform="translate(360.78 -143.1) rotate(45)" />
    </svg>
  );
}

export function LockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 400.5 418.25" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="162.75" cy="132.5" r="132.5" />
      <circle className="cut" cx="162.75" cy="132.5" r="80.5" />
      <rect x="30.25" y="142" width="52" height="78" />
      <rect x="243.25" y="142" width="52" height="78" />
      <rect className="cut" x="82.25" y="124" width="161.01" height="44.98" />
      <rect x="82.25" y="168.98" width="161.01" height="69.03" />
      <path d="M243.25,168.98h57.32c13.63,0,24.68,11.05,24.68,24.68v199.66c0,13.63-11.05,24.68-24.68,24.68H24.93c-13.63,0-24.68-11.05-24.68-24.68v-199.66c0-13.63,11.05-24.68,24.68-24.68h57.32v69.03h161.01v-69.03Z" />
      <rect className="cut" x="147.25" y="260" width="30" height="60" />
      <rect className="cut" x="117.75" y="260.5" width="90" height="30" />
    </svg>
  );
}

export function GearIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="5 -25 320.34 335.05" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="155.17" cy="152.53" r="123.5" />
      <rect x="-1.83" y="125.03" width="314" height="55" rx="7.33" ry="7.33" transform="translate(83.14 -52.79) rotate(26.16)" />
      <rect x="-1.83" y="125.03" width="314" height="55" rx="7.33" ry="7.33" transform="translate(-41.96 60.43) rotate(-19.47)" />
      <rect x="-1.83" y="125.03" width="314" height="55" rx="7.33" ry="7.33" transform="translate(232.65 -50.79) rotate(66.35)" />
      <rect x="-1.83" y="125.03" width="314" height="55" rx="7.33" ry="7.33" transform="translate(-47.95 230.52) rotate(-65.51)" />
      <circle className="cut" cx="155.17" cy="152.53" r="65" />
    </svg>
  );
}
