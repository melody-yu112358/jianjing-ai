'use client';
import {useRef,type ReactNode} from 'react';
export function PresentationDialog({label,children,className=''}:{label:string;children:ReactNode;className?:string}){const ref=useRef<HTMLDialogElement>(null);return <div className={className}><button type="button" className="dialog-trigger" onClick={()=>ref.current?.showModal()}>{label}</button><dialog ref={ref} className="preview-dialog" aria-label={label}><button type="button" className="close-dialog" onClick={()=>ref.current?.close()}>关闭</button>{children}</dialog></div>;}
