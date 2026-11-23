interface StatusLineProps {
  message: string;
}

/** 아래 상태 줄의 안내 문구. 긴 문구는 말줄임으로 자르고 전체는 title로 보여 준다. */
export function StatusLine({ message }: StatusLineProps) {
  return (
    <p className="status-line" data-testid="status-line" title={message}>
      <span className="status-text">{message}</span>
    </p>
  );
}
