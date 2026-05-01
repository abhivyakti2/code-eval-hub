import clsx from 'clsx';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export function Button({ children, className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest} //like onClick, disabled etc. are passed as rest and spread into button element
      className={clsx(
        'flex h-10 items-center rounded-lg bg-blue-500 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 active:bg-blue-600 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
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
