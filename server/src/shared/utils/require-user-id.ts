import { HttpError } from './http-error.js';
export function requireUserId(user: Express.User | undefined): string {
    if (!user)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    return user.id;
}
