'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState, FormEvent } from 'react';
import { useVerifyPrivateKeyRecoveryToken } from "@/hooks/useAuth/useVerifyPrivateKeyRecoveryToken";
import useNavigateToRecoverySuccessfulPageOnPrivateKeyRestoration from '@/hooks/useAuth/useNavigateToRecoverySuccessfulPageOnPrivateKeyRestoration';

function PrivateKeyRecoveryTokenVerificationPageContent() {
    const searchParams = useSearchParams();
    const token = searchParams.get('token');

    // State to manage the password input from the user
    const [passwordInput, setPasswordInput] = useState('');
    // State to know when the verification process should start (e.g., after form submission)
    const [isVerifying, setIsVerifying] = useState(false);

    // Call the hook, but it will only run its logic when isVerifying is true

const { isPrivateKeyRestoredInIndexedDB, isPending: verificationInProgress, error } = useVerifyPrivateKeyRecoveryToken({
    recoveryToken: token,
    passwordInput: passwordInput,
});
    // This hook will navigate the user away upon successful restoration
    useNavigateToRecoverySuccessfulPageOnPrivateKeyRestoration({ isPrivateKeyRestoredInIndexedDB });

    // Function to handle the form submission
    const handlePasswordSubmit = (event: FormEvent) => {
        event.preventDefault(); // Prevent the form from reloading the page
        if (passwordInput.trim()) {
            setIsVerifying(true); // Start the verification process
        }
    };

    // If the key has been restored, you can show a success message or rely on the redirect
    if (isPrivateKeyRestoredInIndexedDB) {
        return <span>Recovery successful! Redirecting...</span>;
    }

    return (
        <div>
            <h1>Recover Your Private Key</h1>
            <p>To complete the recovery process, please enter the password associated with your encrypted key.</p>
            <form onSubmit={handlePasswordSubmit}>
                <div style={{ marginBottom: '1rem' }}>
                    <label htmlFor="password">Password:</label>
                    <input
                        id="password"
                        type="password"
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        required
                        style={{ marginLeft: '0.5rem', minWidth: '250px' }}
                    />
                </div>
                
                {/* Display any errors from the hook */}
                {error && <p style={{ color: 'red' }}>Error: {error}</p>}

                <button type="submit" disabled={verificationInProgress}>
                    {verificationInProgress ? 'Verifying...' : 'Recover and Verify'}
                </button>
            </form>
        </div>
    );
}

export default function Page() {
    return (
        <Suspense fallback={<span>Loading...</span>}>
            <PrivateKeyRecoveryTokenVerificationPageContent />
        </Suspense>
    );
}
