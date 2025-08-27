import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@/hooks/useCashuWallet', () => ({
  useCashuWallet: () => ({
    balance: 1000,
    isLoading: false,
    mintTokens: vi.fn(),
    sendTokens: vi.fn(),
    receiveTokens: vi.fn()
  })
}));

function BalanceDisplay({ balance }: { balance: number }) {
  return (
    <div data-testid="balance-display">
      Balance: {balance} sats
    </div>
  );
}

function SendPayment({ onSend }: { onSend: (amount: number) => void }) {
  const [amount, setAmount] = React.useState('');
  
  return (
    <div>
      <input
        data-testid="amount-input"
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount in sats"
      />
      <button
        data-testid="send-button"
        onClick={() => onSend(parseInt(amount))}
        disabled={!amount || parseInt(amount) <= 0}
      >
        Send
      </button>
    </div>
  );
}

function Message({ text, payment }: { text: string; payment?: number }) {
  return (
    <div data-testid="message">
      <p>{text}</p>
      {payment && <span data-testid="payment-amount">💸 {payment} sats</span>}
    </div>
  );
}

function ChatInput({ onSend }: { onSend: (text: string, payment: number) => void }) {
  const [message, setMessage] = React.useState('');
  const [payment, setPayment] = React.useState('0');
  
  const handleSend = () => {
    if (message.trim()) {
      onSend(message, parseInt(payment) || 0);
      setMessage('');
      setPayment('0');
    }
  };
  
  return (
    <div>
      <input
        data-testid="message-input"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Type a message..."
      />
      <input
        data-testid="payment-input"
        type="number"
        value={payment}
        onChange={(e) => setPayment(e.target.value)}
        placeholder="Payment amount"
      />
      <button
        data-testid="send-message-button"
        onClick={handleSend}
        disabled={!message.trim()}
      >
        Send
      </button>
    </div>
  );
}

describe('Chat Components', () => {
  describe('BalanceDisplay', () => {
    it('shows the current balance', () => {
      render(<BalanceDisplay balance={1500} />);
      expect(screen.getByTestId('balance-display')).toHaveTextContent('Balance: 1500 sats');
    });
    
    it('shows zero balance', () => {
      render(<BalanceDisplay balance={0} />);
      expect(screen.getByTestId('balance-display')).toHaveTextContent('Balance: 0 sats');
    });
  });
  
  describe('SendPayment', () => {
    it('sends payment with valid amount', async () => {
      const onSend = vi.fn();
      render(<SendPayment onSend={onSend} />);
      
      const input = screen.getByTestId('amount-input');
      const button = screen.getByTestId('send-button');
      
      fireEvent.change(input, { target: { value: '100' } });
      fireEvent.click(button);
      
      expect(onSend).toHaveBeenCalledWith(100);
    });
    
    it('disables send with invalid amount', () => {
      const onSend = vi.fn();
      render(<SendPayment onSend={onSend} />);
      
      const button = screen.getByTestId('send-button');
      expect(button).toBeDisabled();
      
      const input = screen.getByTestId('amount-input');
      fireEvent.change(input, { target: { value: '0' } });
      expect(button).toBeDisabled();
      
      fireEvent.change(input, { target: { value: '-10' } });
      expect(button).toBeDisabled();
    });
  });
  
  describe('Message', () => {
    it('displays message text', () => {
      render(<Message text="Hello world" />);
      expect(screen.getByText('Hello world')).toBeInTheDocument();
    });
    
    it('displays message with payment', () => {
      render(<Message text="Thanks!" payment={50} />);
      expect(screen.getByText('Thanks!')).toBeInTheDocument();
      expect(screen.getByTestId('payment-amount')).toHaveTextContent('💸 50 sats');
    });
    
    it('displays message without payment', () => {
      render(<Message text="Hi there" />);
      expect(screen.getByText('Hi there')).toBeInTheDocument();
      expect(screen.queryByTestId('payment-amount')).not.toBeInTheDocument();
    });
  });
  
  describe('ChatInput', () => {
    it('sends message without payment', () => {
      const onSend = vi.fn();
      render(<ChatInput onSend={onSend} />);
      
      const messageInput = screen.getByTestId('message-input');
      const sendButton = screen.getByTestId('send-message-button');
      
      fireEvent.change(messageInput, { target: { value: 'Hello' } });
      fireEvent.click(sendButton);
      
      expect(onSend).toHaveBeenCalledWith('Hello', 0);
    });
    
    it('sends message with payment', () => {
      const onSend = vi.fn();
      render(<ChatInput onSend={onSend} />);
      
      const messageInput = screen.getByTestId('message-input');
      const paymentInput = screen.getByTestId('payment-input');
      const sendButton = screen.getByTestId('send-message-button');
      
      fireEvent.change(messageInput, { target: { value: 'Great work!' } });
      fireEvent.change(paymentInput, { target: { value: '100' } });
      fireEvent.click(sendButton);
      
      expect(onSend).toHaveBeenCalledWith('Great work!', 100);
    });
    
    it('clears inputs after sending', () => {
      const onSend = vi.fn();
      render(<ChatInput onSend={onSend} />);
      
      const messageInput = screen.getByTestId('message-input') as HTMLInputElement;
      const paymentInput = screen.getByTestId('payment-input') as HTMLInputElement;
      
      fireEvent.change(messageInput, { target: { value: 'Test' } });
      fireEvent.change(paymentInput, { target: { value: '50' } });
      fireEvent.click(screen.getByTestId('send-message-button'));
      
      expect(messageInput.value).toBe('');
      expect(paymentInput.value).toBe('0');
    });
    
    it('disables send with empty message', () => {
      const onSend = vi.fn();
      render(<ChatInput onSend={onSend} />);
      
      const sendButton = screen.getByTestId('send-message-button');
      expect(sendButton).toBeDisabled();
      
      const messageInput = screen.getByTestId('message-input');
      fireEvent.change(messageInput, { target: { value: '   ' } });
      expect(sendButton).toBeDisabled();
    });
  });
});

describe('Payment Flow Integration', () => {
  it('completes full payment cycle', async () => {
    const PaymentApp = () => {
      const [balance, setBalance] = React.useState(1000);
      const [messages, setMessages] = React.useState<Array<{text: string, payment: number}>>([]);
      
      const handleSend = (text: string, payment: number) => {
        if (payment <= balance) {
          setBalance(b => b - payment);
          setMessages(m => [...m, { text, payment }]);
        }
      };
      
      return (
        <div>
          <BalanceDisplay balance={balance} />
          <ChatInput onSend={handleSend} />
          <div data-testid="messages">
            {messages.map((m, i) => (
              <Message key={i} text={m.text} payment={m.payment} />
            ))}
          </div>
        </div>
      );
    };
    
    render(<PaymentApp />);
    
    expect(screen.getByTestId('balance-display')).toHaveTextContent('Balance: 1000 sats');
    fireEvent.change(screen.getByTestId('message-input'), { target: { value: 'First message' } });
    fireEvent.change(screen.getByTestId('payment-input'), { target: { value: '100' } });
    fireEvent.click(screen.getByTestId('send-message-button'));
    await waitFor(() => {
      expect(screen.getByTestId('balance-display')).toHaveTextContent('Balance: 900 sats');
    });
    expect(screen.getByText('First message')).toBeInTheDocument();
    expect(screen.getByTestId('payment-amount')).toHaveTextContent('💸 100 sats');
    fireEvent.change(screen.getByTestId('message-input'), { target: { value: 'Second message' } });
    fireEvent.change(screen.getByTestId('payment-input'), { target: { value: '200' } });
    fireEvent.click(screen.getByTestId('send-message-button'));
    await waitFor(() => {
      expect(screen.getByTestId('balance-display')).toHaveTextContent('Balance: 700 sats');
    });
  });
  
  it('prevents overspending', () => {
    const PaymentApp = () => {
      const [balance] = React.useState(100);
      const [error, setError] = React.useState('');
      
      const handleSend = (amount: number) => {
        if (amount > balance) {
          setError('Insufficient balance');
        }
      };
      
      return (
        <div>
          <BalanceDisplay balance={balance} />
          <SendPayment onSend={handleSend} />
          {error && <div data-testid="error">{error}</div>}
        </div>
      );
    };
    
    render(<PaymentApp />);
    fireEvent.change(screen.getByTestId('amount-input'), { target: { value: '200' } });
    fireEvent.click(screen.getByTestId('send-button'));
    expect(screen.getByTestId('error')).toHaveTextContent('Insufficient balance');
  });
});