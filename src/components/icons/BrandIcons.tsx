import type { CSSProperties, HTMLAttributes } from "react";
import type { SVGProps } from "react";
import btLogoUrl from "../../assets/bt-logo.png";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/** Docker 官方鲸鱼（Simple Icons），跟随 currentColor */
export function DockerIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      {...props}
    >
      <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z" />
    </svg>
  );
}

/**
 * KubeSphere 官方图形标（@kubed/icons KubesphereLogoFill），跟随 currentColor。
 * https://github.com/kubesphere/kube-design
 */
export function KubeSphereIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="currentColor"
      aria-hidden
      {...props}
    >
      <path d="M23.979 2L5 13.008v22.075L23.979 46V29.343l-9.133-5.296 9.133-5.297V2zM28.767 4.72l9.7 5.627-9.7 5.626V4.72zM38.468 37.745l-9.701 5.63V32.122l9.701 5.623zM43 35.041L24.046 24.047 43 13.055v21.986z" />
    </svg>
  );
}

type BaotaIconProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  size?: number;
};

/**
 * 宝塔面板（bt.cn）官方外形，单色：mask + currentColor（与侧栏其它图标一致）。
 * 外形来自 https://www.bt.cn/Public/images/bt_logo_new.png
 */
export function BaotaIcon({ size = 14, style, ...props }: BaotaIconProps) {
  const maskStyle: CSSProperties = {
    width: size,
    height: size,
    display: "inline-block",
    flexShrink: 0,
    backgroundColor: "currentColor",
    maskImage: `url(${btLogoUrl})`,
    maskSize: "contain",
    maskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskImage: `url(${btLogoUrl})`,
    WebkitMaskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    ...style,
  };
  return <span aria-hidden style={maskStyle} {...props} />;
}
