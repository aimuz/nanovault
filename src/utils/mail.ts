/**
 * Email Utility Module
 * 
 * Sends emails via Resend API.
 * Uses native fetch to avoid extra dependencies.
 */

import type { Bindings } from '../types'

/**
 * Send an email via Resend
 * 
 * @param env - Environment bindings containing RESEND_API_KEY and MAIL_FROM
 * @param to - Recipient email address
 * @param subject - Email subject
 * @param html - Email body in HTML format
 * @returns boolean indicating success
 */
export const sendMail = async (
    env: Bindings,
    to: string,
    subject: string,
    html: string
): Promise<boolean> => {
    if (!env.RESEND_API_KEY) {
        return false
    }

    const from = env.MAIL_FROM || 'Nanovault <onboarding@resend.dev>'

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from,
                to: [to],
                subject,
                html
            })
        })

        if (!response.ok) {
            const error = await response.text()
            console.error('[Mail] Resend error:', error)
            return false
        }

        console.log(`[Mail] Email sent to ${to}: ${subject}`)
        return true
    } catch (e) {
        console.error('[Mail] Failed to send email:', e)
        return false
    }
}
