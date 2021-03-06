import { localize } from '@deriv/translations';
import { proposalsReady, clearProposals } from './state/actions';
import { tradeOptionToProposal, doUntilDone } from '../utils/helpers';

export default Engine =>
    class Proposal extends Engine {
        makeProposals(trade_option) {
            if (!this.isNewTradeOption(trade_option)) {
                return;
            }

            // Generate a purchase reference when trade options are different from previous trade options.
            // This will ensure the bot doesn't mistakenly purchase the wrong proposal.
            this.regeneratePurchaseReference();
            this.trade_option = trade_option;
            this.proposal_templates = tradeOptionToProposal(trade_option, this.getPurchaseReference());
            this.renewProposalsOnPurchase();
        }

        selectProposal(contract_type) {
            const { proposals } = this.data;

            if (proposals.length === 0) {
                throw Error(localize('Proposals are not ready'));
            }

            const to_buy = proposals.find(proposal => {
                if (
                    proposal.contract_type === contract_type &&
                    proposal.purchase_reference === this.getPurchaseReference()
                ) {
                    // Below happens when a user has had one of the proposals return
                    // with a ContractBuyValidationError. We allow the logic to continue
                    // to here cause the opposite proposal may still be valid. Only once
                    // they attempt to purchase the errored proposal we will intervene.
                    if (proposal.error) {
                        throw proposal.error;
                    }

                    return proposal;
                }

                return false;
            });

            if (!to_buy) {
                throw new Error(localize('Selected proposal does not exist'));
            }

            return {
                id: to_buy.id,
                askPrice: to_buy.ask_price,
            };
        }

        renewProposalsOnPurchase() {
            this.unsubscribeProposals().then(() => this.requestProposals());
        }

        clearProposals() {
            this.data.proposals = [];
            this.store.dispatch(clearProposals());
        }

        requestProposals() {
            Promise.all(
                this.proposal_templates.map(proposal =>
                    doUntilDone(() =>
                        this.api.subscribeToPriceForContractProposal(proposal).catch(error => {
                            // We intercept ContractBuyValidationError as user may have specified
                            // e.g. a DIGITUNDER 0 or DIGITOVER 9, while one proposal may be invalid
                            // the other is valid. We will error on Purchase rather than here.
                            if (error?.name === 'ContractBuyValidationError') {
                                this.data.proposals.push({
                                    ...error.error.echo_req,
                                    ...error.error.echo_req.passthrough,
                                    error,
                                });

                                return null;
                            }

                            throw error;
                        })
                    )
                )
            );
        }

        observeProposals() {
            this.listen('proposal', response => {
                const { passthrough, proposal } = response;

                if (
                    this.data.proposals.findIndex(p => p.id === proposal.id) === -1 &&
                    !this.data.forget_proposal_ids.includes(proposal.id)
                ) {
                    // Add proposals based on the ID returned by the API.
                    this.data.proposals.push({ ...proposal, ...passthrough });
                    this.checkProposalReady();
                }
            });
        }

        unsubscribeProposals() {
            const { proposals } = this.data;
            const removeForgetProposalById = forget_proposal_id =>
                (this.data.forget_proposal_ids = this.data.forget_proposal_ids.filter(id => id !== forget_proposal_id));

            this.clearProposals();

            return Promise.all(
                proposals.map(proposal => {
                    if (!this.data.forget_proposal_ids.includes(proposal.id)) {
                        this.data.forget_proposal_ids.push(proposal.id);
                    }

                    if (proposal.error) {
                        removeForgetProposalById(proposal.id);
                        return Promise.resolve();
                    }

                    return doUntilDone(() => this.api.unsubscribeByID(proposal.id)).then(() => {
                        removeForgetProposalById(proposal.id);
                    });
                })
            );
        }

        checkProposalReady() {
            // Proposals are considered ready when the proposals in our memory match the ones
            // we've requested from the API, we determine this by checking the passthrough of the response.
            const { proposals } = this.data;

            if (proposals.length > 0) {
                const has_equal_length = proposals.length === this.proposal_templates.length;
                const hasEqualProposals = () =>
                    this.proposal_templates.every(template => {
                        return (
                            proposals.findIndex(proposal => {
                                return (
                                    proposal.purchase_reference === template.passthrough.purchase_reference &&
                                    proposal.contract_type === template.contract_type
                                );
                            }) !== -1
                        );
                    });

                if (has_equal_length && hasEqualProposals()) {
                    this.startPromise.then(() => this.store.dispatch(proposalsReady()));
                }
            }
        }

        isNewTradeOption(trade_option) {
            if (!this.trade_option) {
                this.trade_option = trade_option;
                return true;
            }

            // Compare incoming "trade_option" argument with "this.trade_option", if any
            // of the values is different, this is a new tradeOption and new proposals
            // should be generated.
            return [
                'amount',
                'barrierOffset',
                'basis',
                'duration',
                'duration_unit',
                'prediction',
                'secondBarrierOffset',
                'symbol',
            ].some(value => this.trade_option[value] !== trade_option[value]);
        }
    };
