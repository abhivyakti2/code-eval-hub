import clsx from 'clsx';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export function Button({ children, className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest} //like onClick, disabled etc. are passed as rest and spread into button element
      className={clsx(
        'inline-flex items-center justify-center rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60',
        className,
      )}
      //how is className prop vs the button element's className working here? they have same name but they are different. the className prop is passed to Button component when it is used, and then it is combined with the default classes using clsx and passed to the button element's className. this allows us to add custom classes to the button when we use it, while still keeping the default styles.
      // standard ButtonHTMLAttributes merge pattern
>
      {children} 
      {/* the text, icon component etc that goes inside Button component is passed as children automatically by React */}
    </button>
  );
}
