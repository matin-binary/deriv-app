import { observable, action, computed } from 'mobx';
import { localize } from '@deriv/translations';
import { formatDate } from '@deriv/shared';
import { message_types } from '@deriv/bot-skeleton';
import { config } from '@deriv/bot-skeleton/src/constants/config';
import { storeSetting, getSetting } from '../utils/settings';
import { isCustomJournalMessage } from '../utils/journal-notifications';

export default class JournalStore {
    constructor(root_store) {
        this.root_store = root_store;
        this.dbot = this.root_store.dbot;
    }

    getServerTime() {
        return this.root_store.core.common.server_time.get();
    }

    playAudio = sound => {
        if (sound !== config.lists.NOTIFICATION_SOUND[0][1]) {
            const audio = document.getElementById(sound);
            audio.play();
        }
    };

    filters = [
        { id: message_types.ERROR, label: localize('Errors') },
        { id: message_types.NOTIFY, label: localize('Notifications') },
        { id: message_types.SUCCESS, label: localize('System') },
    ];

    @observable is_filter_dialog_visible = false;
    @observable unfiltered_messages = [];
    @observable journal_filters = getSetting('journal_filter') || this.filters.map(filter => filter.id);

    @action.bound
    toggleFilterDialog() {
        this.is_filter_dialog_visible = !this.is_filter_dialog_visible;
    }

    @action.bound
    onLogSuccess(message) {
        const { log_type, extra } = message;
        this.pushMessage(log_type, message_types.SUCCESS, '', extra);
    }

    @action.bound
    onError(message) {
        this.pushMessage(message, message_types.ERROR);
    }

    @action.bound
    onNotify(data) {
        const { run_panel } = this.root_store;
        const { message, className, message_type, sound, block_id, variable_name } = data;

        if (
            isCustomJournalMessage(
                { message, block_id, variable_name },
                run_panel.showErrorMessage,
                () => this.dbot.centerAndHighlightBlock(block_id, true),
                parsed_message => this.pushMessage(parsed_message, message_type || message_types.NOTIFY, className)
            )
        ) {
            this.playAudio(sound);
            return;
        }
        this.pushMessage(message, message_type || message_types.NOTIFY, className);
        this.playAudio(sound);
    }

    @action.bound
    pushMessage(message, message_type, className, extra = {}) {
        const date = formatDate(this.getServerTime());
        const time = formatDate(this.getServerTime(), 'HH:mm:ss [GMT]');
        const unique_id = Blockly.utils.genUid();

        this.unfiltered_messages.unshift({ date, time, message, message_type, className, unique_id, extra });
    }

    @computed
    get filtered_messages() {
        // filter messages based on filtered-checkbox
        return this.unfiltered_messages.filter(
            message =>
                this.journal_filters.length && this.journal_filters.some(filter => message.message_type === filter)
        );
    }

    @computed
    get checked_filters() {
        return this.journal_filters.filter(filter => filter != null);
    }

    @action.bound
    filterMessage(checked, item_id) {
        if (checked) {
            this.journal_filters.push(item_id);
        } else {
            this.journal_filters.splice(this.journal_filters.indexOf(item_id), 1);
        }

        storeSetting('journal_filter', this.journal_filters);
    }

    @action.bound
    clear() {
        this.unfiltered_messages.clear();
    }
}
